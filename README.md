# express-memjs-cache
This is an Express middleware that caches responses using the [MemJS]
memcached client.

## Installation
0. Set up your Express project

1. Install the `express-memjs-cache` npm package:

    ```sh
    npm install express-memjs-cache
    ```

2. Add the [Memcachier Heroku add-on] to your app

## Setup
Place the middleware before your Express response handler(s):

```js
const express = require('express')
const cache = require('express-memjs-cache')
const app = express()
  .use(cache({ cacheMaxAge: 60 }))
  .get('/widgets', expensiveListWidgets)
```

In this arrangement, responses will be cached using the URI
([request.originalUrl], which includes the query string) as the cache
key. The first request will miss the cache and set the cache key to the
sent response body. Subsequent requests to the same URL will "hit" the
cache and respond with the cached response body until the cached entry's
age is at or above the `cacheMaxAge` (in this case, 60 seconds).

### Cache keys
The default cache key of the [request.originalUrl] should serve most uses
cases, but you can customize the cache key in a couple of different ways
to suit your needs.

**Regardless of how you do it, you will need to calculate the cache key
_before_ the cache middleware runs.** The cache needs the cache key to
determine whether it can serve the request, but it also needs the your
handler(s) to generate a response body to cache.

1. Provide your own `getCacheKey` option as a function that takes the
   Express request and response objects as arguments and returns a
   string.

2. Set the `x-cache-key` response header. As with a custom `getCacheKey`
   function, you will need to set this header in a handler or middleware
   _before_ the cache.

[memjs]: https://memjs.netlify.app
[memcachier heroku add-on]: https://elements.heroku.com/addons/memcachier
[request.originalUrl]: https://expressjs.com/en/4x/api.html#req.originalUrl
