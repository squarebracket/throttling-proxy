const http = require('http');
const https = require('https');
const process = require('process');

const chalk = require('chalk');
const express = require('express');
const prettyBytes = require('pretty-bytes');
const { ThrottleGroup } = require('stream-throttle');

const {
  IGNORE_HEADERS = 'server,date,x-vtx-location',
  INITIAL_SPEED = 1073741824,
} = process.env;
const IGNORE_HEADERS_ARRAY = IGNORE_HEADERS.split(',');

// always force colour display
chalk.level = 1;

let app;
let numRequests = {};

app = express();
const speed = {};
const throttleGroups = {};

const log = (userAgent, level, msg) => {
  console[level](`${chalk.cyan(userAgent)}: ${msg}`);
};

app.get('/:userAgent/speed/:speed', function(request, response) {
  const userAgent = request.params.userAgent;
  const newSpeed = parseInt(request.params.speed);
  if (isNaN(newSpeed)) {
    const msg = `Couldn't parse integer from string '${request.params.speed}'`;
    response.status(400);
    log(userAgent, 'error', `${chalk.red(msg)}`);
    response.send(msg);
    return;
  }

  const tg = throttleGroups[userAgent];
  let msg;
  const newSpeedHuman = prettyBytes(newSpeed, {binary: true});
  speed[userAgent] = newSpeed;
  if (!tg) {
    msg = `Setting throttle rate to ${newSpeedHuman}/s`;
  } else {
    const oldSpeedHuman = prettyBytes(tg.bucket.tokensPerInterval, {binary: true});
    msg = `Queuing throttle rate change from ${oldSpeedHuman}/s to ${newSpeedHuman}/s`;
    tg.setRate(newSpeed);
  }
  log(userAgent, 'info', msg.replace('throttle rate', chalk.magenta('throttle rate')));
  response.status(200);
  response.send(msg);
});

// Need to use regexes because otherwise it won't capture `/`s in urls properly
app.get(/^\/(.+)\/proxy\/(.+)/, function(request, response) {
  const userAgent = request.params[0];
  const reqUrl = request.params[1];

  if (!speed[userAgent]) {
    speed[userAgent] = INITIAL_SPEED;
  }
  if (!(userAgent in numRequests)) {
    numRequests[userAgent] = 0;
  }

  const url = reqUrl.startsWith('http') ? reqUrl : `https://${reqUrl}`;
  // node forces to use https for https:// and vice versa
  const getter = reqUrl.startsWith('https://') ? https : http;
  if (!throttleGroups[userAgent]) {
    throttleGroups[userAgent] = new ThrottleGroup({rate: speed[userAgent]});
  }
  const throttle = throttleGroups[userAgent].throttle();

  numRequests[userAgent]++;

  const throttleSpeedHuman = prettyBytes(speed[userAgent], {binary: true});
  log(userAgent, 'info', `Throttling request for ${url} to ${throttleSpeedHuman}/s`);

  const reqData = {
    url,
    speed: throttle.bucket.tokensPerInterval,
    startTime: Date.now(),
  };

  const proxyGet = getter.get(url, (res) => {
    for (let header in res.headers) {
      if (IGNORE_HEADERS_ARRAY.indexOf(header) === -1) {
        response.set(header, res.headers[header]);
      }
    }
    if (res.statusCode !== 200) {
      const msg = `Got status code ${res.statusCode} for ${url}`;
      log(userAgent, 'error', chalk.red(msg));
      response.status(res.statusCode);
    }
    res.pipe(throttle).pipe(response).on('error', (err) => {
      const msg = `Error piping server response through throttle: ${err}`;
      log(userAgent, 'error', msg);
      response.end();
    });
    const finish = () => {
      reqData.size = res.complete ? res.headers['content-length'] : NaN;
      reqData.time = (Date.now() - reqData.startTime) / 1000;
      if (reqData.speed !== speed[userAgent]) {
        // rate changed during download so we can't reliably measure rate
        reqData.speed = NaN;
      }
      let urlFirst = url.slice(0, url.lastIndexOf('.'));
      let ext = url.slice(url.lastIndexOf('.') + 1);
      let rate = reqData.size / reqData.time;

      let statusText;
      if (res.complete) {
        statusText = chalk.green('Completed');
      } else if (res.aborted) {
        statusText = chalk.yellow('Aborted');
      } else {
        statusText = chalk.red('Errored');
      }

      let fileInfo = `${urlFirst}.${chalk.blue(ext)}`;
      if (res.headers['content-type']) {
        fileInfo += ` (${chalk.blue(res.headers['content-type'])})`;
      }

      const sizeHuman = prettyBytes(parseInt(reqData.size));
      const actualRateHuman = prettyBytes(rate, {binary: true}) + '/s';
      const reqRateHuman = isNaN(reqData.speed) ? NaN :
        prettyBytes(reqData.speed, {binary: true}) + '/s';
      const timingInfo = `${sizeHuman} over ${reqData.time} s ` +
        `(${chalk.green(actualRateHuman)} / ${chalk.yellow(reqRateHuman)})`;

      const concurrentReqs = `[${numRequests[userAgent]} concurrent requests]`;

      const msg = `${statusText} ${fileInfo} --> ${timingInfo} ${concurrentReqs}`;
      log(userAgent, 'info', msg);
      numRequests[userAgent]--;
    };
    res.on('end', finish);
    res.on('error', finish);
  })
  .on('error', (e) => {
    const msg = `Error getting ${url} from server: ${chalk.red(e)}`;
    log(userAgent, 'error', msg);
    response.end();
  });
  request.on('aborted', () => {
    proxyGet.abort();
  });
});

app.listen(3000);
