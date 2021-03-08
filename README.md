# throttling-proxy

A small app that can be used to throttle HTTP requests.

## Usage

The app can be run either as a nodejs app:

```shell
git clone https://github.com/squarebracket/throttling-proxy.git; cd throttling-proxy; npm i && npm start
```

or as a docker container:

```shell
docker run --rm -d -p 3000:3000 squarebracket/throttling-proxy
```

Note that https urls will have their cert verified, so if you need extra CAs
you can mount a file with the extra CA certs to `/extra-ca-certs.pem` (the
`NODE_EXTRA_CA_CERTS` environment variable is set to this file).

It's also expected that you'll run this server behind a reverse proxy which
would provide for any other configuration you want, such as configuring CORS.

## Throttling Requests

Requests are _not_ throttled in the typical proxy way. They are throttled by
requesting from specific URLs.

In order to keep things separated, "request streams" are separated into groups
that have throttling applied to all requests from the originator. This is done
by specifying a "user-agent", which can be any arbitrary string.

There are two URLs that control the throttling behaviour.

### `/:user_agent/speed/:speed`

Sets the throttling speed for throttling group `user_agent` to `speed`. The
unit is metric bytes, i.e. for a throttle rate of 1 MiB/s, you should use
`1048576`.

### `/:user_agent/proxy/:url`

Request `:url`, throttling using throttle group `:user_agent`.
