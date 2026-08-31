const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const STOP_WORDS = new Set([
  "this", "that", "with", "from", "have", "will", "your",
  "what", "when", "where", "about", "they", "their", "there",
  "would", "could", "should", "just", "been", "into", "more",
  "than", "some", "very", "here", "were", "them", "then",
  "also", "only", "over", "after", "before", "because", "while",
  "really", "still", "going", "make", "made", "today", "right",
  "people", "thing", "things", "like", "said", "says", "saying",
  "breaking", "viral", "trending", "news", "update", "thread",
  "watch", "look", "https", "http", "the", "and", "for", "are",
  "was", "you", "but", "not", "all", "can", "out", "has",
  "had", "its", "our", "who", "how", "why", "now", "new",
  "get", "got", "one", "two", "too", "official", "latest"
]);

const BLOCKED_PHRASES = [
  "join telegram",
  "telegram group",
  "signal group",
  "private alpha",
  "drop your wallet",
  "send wallet",
  "presale",
  "100x",
  "1000x",
  "buy now",
  "dm me for",
  "guaranteed profit",
  "entry now",
  "easy 10x",
  "gem call"
];

/*
|--------------------------------------------------------------------------
| BROAD DISCOVERY SENSORS
|
| Sengaja cuma 4 sensor besar.
| Jangan 12 request bersamaan lagi.
|--------------------------------------------------------------------------
*/

const SENSORS = [
  {
    id: "breaking",
    query:
      "breaking OR confirmed OR announced OR launch OR launched OR mainnet OR listing OR partnership OR acquisition"
  },

  {
    id: "social",
    query:
      "viral OR trending OR meme OR controversy OR scandal OR drama OR celebrity OR streamer"
  },

  {
    id: "crypto-tech",
    query:
      "crypto OR blockchain OR web3 OR nft OR defi OR stablecoin OR AI OR technology OR startup"
  },

  {
    id: "world-markets",
    query:
      "CEO OR founder OR president OR government OR market OR stock OR ETF OR gaming OR sports"
  }
];

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(
    Math.max(n, min),
    max
  );
}

function getTweetsFromResponse(data) {
  if (Array.isArray(data?.tweets)) {
    return data.tweets;
  }

  if (Array.isArray(data?.data?.tweets)) {
    return data.data.tweets;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}

function getNextCursor(data) {
  return (
    data?.next_cursor ||
    data?.nextCursor ||
    data?.cursor?.next ||
    data?.data?.next_cursor ||
    data?.data?.nextCursor ||
    null
  );
}

function cleanText(text = "") {
  return String(text)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getUsername(tweet) {
  const author =
    tweet?.author ||
    tweet?.user ||
    {};

  return (
    author?.userName ||
    author?.username ||
    tweet?.userName ||
    tweet?.username ||
    ""
  );
}

function getCreatedAt(tweet) {
  return (
    tweet?.createdAt ||
    tweet?.created_at ||
    null
  );
}

/*
|--------------------------------------------------------------------------
| TWITTER API
|--------------------------------------------------------------------------
*/

async function requestSearchPage(
  apiKey,
  query,
  since,
  cursor = null
) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
  );

  url.searchParams.set(
    "queryType",
    "Latest"
  );

  if (cursor) {
    url.searchParams.set(
      "cursor",
      cursor
    );
  }

  let response;

  try {
    response = await fetch(
      url.toString(),
      {
        method: "GET",

        headers: {
          "X-API-Key": apiKey,
          "Accept": "application/json"
        }
      }
    );
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: String(error),
      tweets: [],
      nextCursor: null
    };
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    ok: response.ok,

    status:
      response.status,

    error:
      response.ok
        ? null
        : (
            data?.message ||
            data?.error ||
            `HTTP ${response.status}`
          ),

    tweets:
      getTweetsFromResponse(data),

    nextCursor:
      getNextCursor(data)
  };
}

/*
|--------------------------------------------------------------------------
| SENSOR COLLECTION
|--------------------------------------------------------------------------
*/

async function collectSensor(
  apiKey,
  sensor,
  since,
  maxPages
) {
  const collected = [];
  const seen = new Set();

  const statuses = [];

  let cursor = null;
  let pagesFetched = 0;
  let rateLimited = false;
  let lastError = null;

  for (
    let pageIndex = 0;
    pageIndex < maxPages;
    pageIndex++
  ) {
    let result =
      await requestSearchPage(
        apiKey,
        sensor.query,
        since,
        cursor
      );

    /*
    |--------------------------------------------------------------------------
    | 429 RETRY
    |--------------------------------------------------------------------------
    */

    if (result.status === 429) {
      rateLimited = true;

      await sleep(5500);

      result =
        await requestSearchPage(
          apiKey,
          sensor.query,
          since,
          cursor
        );
    }

    statuses.push(
      result.status
    );

    if (!result.ok) {
      lastError =
        result.error;

      break;
    }

    pagesFetched++;

    for (const tweet of result.tweets) {
      if (!tweet?.id) {
        continue;
      }

      if (seen.has(tweet.id)) {
        continue;
      }

      seen.add(tweet.id);
      collected.push(tweet);
    }

    /*
    |--------------------------------------------------------------------------
    | STOP PAGINATION
    |--------------------------------------------------------------------------
    */

    if (!result.nextCursor) {
      break;
    }

    if (
      result.nextCursor === cursor
    ) {
      break;
    }

    cursor =
      result.nextCursor;

    /*
    |--------------------------------------------------------------------------
    | DELAY ANTAR PAGE
    |--------------------------------------------------------------------------
    */

    if (
      pageIndex + 1 <
      maxPages
    ) {
      await sleep(5200);
    }
  }

  return {
    id: sensor.id,

    query:
      sensor.query,

    pagesFetched,

    count:
      collected.length,

    statuses,

    rateLimited,

    error:
      lastError,

    tweets:
      collected
  };
}

/*
|--------------------------------------------------------------------------
| SPAM / NOISE FILTER
|--------------------------------------------------------------------------
*/

function hasCryptoAddress(text = "") {
  const evm =
    /\b0x[a-fA-F0-9]{40}\b/;

  /*
  |--------------------------------------------------------------------------
  | Solana-like address
  |--------------------------------------------------------------------------
  */

  const solana =
    /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

  return (
    evm.test(text) ||
    solana.test(text)
  );
}

function isLikelyReply(text = "") {
  const t =
    String(text).trim();

  if (!t) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Tweet yang cuma reply akun
  |--------------------------------------------------------------------------
  */

  if (
    /^@\w+\s+/i.test(t) &&
    cleanText(t).length < 100
  ) {
    return true;
  }

  return false;
}

function isNoise(text = "") {
  const original =
    String(text);

  const t =
    original
      .toLowerCase()
      .trim();

  if (!t) {
    return true;
  }

  if (
    cleanText(original).length <
    15
  ) {
    return true;
  }

  if (
    isLikelyReply(original)
  ) {
    return true;
  }

  for (
    const phrase of
    BLOCKED_PHRASES
  ) {
    if (
      t.includes(phrase)
    ) {
      return true;
    }
  }

  if (
    t.includes("ca:") ||
    t.includes("contract address:")
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Memecoin shill
  |--------------------------------------------------------------------------
  */

  if (
    hasCryptoAddress(original)
  ) {
    const shillWords = [
      "moon",
      "ape",
      "entry",
      "mc",
      "market cap",
      "send it",
      "pump",
      "gem",
      "caller",
      "calls"
    ];

    if (
      shillWords.some(
        (word) =>
          t.includes(word)
      )
    ) {
      return true;
    }
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| AGE
|--------------------------------------------------------------------------
*/

function ageBoost(ageMinutes) {
  if (ageMinutes <= 1) {
    return 5;
  }

  if (ageMinutes <= 2) {
    return 4;
  }

  if (ageMinutes <= 5) {
    return 3;
  }

  if (ageMinutes <= 10) {
    return 2;
  }

  if (ageMinutes <= 20) {
    return 1.3;
  }

  return 1;
}

/*
|--------------------------------------------------------------------------
| KEYWORDS
|--------------------------------------------------------------------------
*/

function extractKeywords(text = "") {
  const cleaned =
    String(text)
      .replace(
        /https?:\/\/\S+/gi,
        " "
      )
      .replace(
        /@\w+/g,
        " "
      )
      .replace(
        /[^\p{L}\p{N}#$\s]/gu,
        " "
      )
      .toLowerCase();

  const output = [];

  const words =
    cleaned
      .split(/\s+/)
      .filter(Boolean);

  for (const word of words) {
    if (word.length < 3) {
      continue;
    }

    if (
      STOP_WORDS.has(word)
    ) {
      continue;
    }

    if (
      !output.includes(word)
    ) {
      output.push(word);
    }

    if (
      output.length >= 20
    ) {
      break;
    }
  }

  return output;
}

/*
|--------------------------------------------------------------------------
| ENTITY EXTRACTION
|--------------------------------------------------------------------------
*/

function extractEntities(text = "") {
  const cleaned =
    cleanText(text);

  const capitalized =
    cleaned.match(
      /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g
    ) || [];

  const tickers =
    cleaned.match(
      /\$[A-Za-z][A-Za-z0-9]{1,10}/g
    ) || [];

  const hashtags =
    cleaned.match(
      /#[A-Za-z][A-Za-z0-9_]{2,40}/g
    ) || [];

  return [
    ...new Set(
      [
        ...capitalized,
        ...tickers,
        ...hashtags
      ]
        .map(
          (value) =>
            value
              .toLowerCase()
              .trim()
        )
        .filter(
          (value) =>
            value.length >= 3
        )
    )
  ].slice(0, 15);
}

/*
|--------------------------------------------------------------------------
| SIMILARITY
|--------------------------------------------------------------------------
*/

function jaccard(a, b) {
  if (
    !a.length ||
    !b.length
  ) {
    return 0;
  }

  const A =
    new Set(a);

  const B =
    new Set(b);

  let intersection = 0;

  for (const value of A) {
    if (
      B.has(value)
    ) {
      intersection++;
    }
  }

  const union =
    new Set([
      ...A,
      ...B
    ]).size;

  if (!union) {
    return 0;
  }

  return (
    intersection /
    union
  );
}

function clusterMatch(a, b) {
  /*
  |--------------------------------------------------------------------------
  | Shared entity
  |--------------------------------------------------------------------------
  */

  const sharedEntity =
    a.entities.some(
      (entity) =>
        entity.length >= 4 &&
        b.entities.includes(entity)
    );

  if (sharedEntity) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Shared keywords
  |--------------------------------------------------------------------------
  */

  const sharedKeywords =
    a.keywords.filter(
      (keyword) =>
        b.keywords.includes(keyword)
    );

  if (
    sharedKeywords.length >= 2
  ) {
    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | Overall similarity
  |--------------------------------------------------------------------------
  */

  return (
    jaccard(
      a.keywords,
      b.keywords
    ) >= 0.22
  );
}

/*
|--------------------------------------------------------------------------
| CLUSTER
|--------------------------------------------------------------------------
*/

function buildClusters(tweets) {
  const clusters = [];

  for (const tweet of tweets) {
    let bestCluster = null;

    for (
      const cluster of
      clusters
    ) {
      const matches =
        cluster.some(
          (member) =>
            clusterMatch(
              tweet,
              member
            )
        );

      if (matches) {
        bestCluster =
          cluster;

        break;
      }
    }

    if (bestCluster) {
      bestCluster.push(tweet);
    } else {
      clusters.push([tweet]);
    }
  }

  return clusters;
}

/*
|--------------------------------------------------------------------------
| NARRATIVE NAME
|--------------------------------------------------------------------------
*/

function makeNarrativeName(cluster) {
  const entityCounts = {};
  const keywordCounts = {};

  for (const tweet of cluster) {
    for (
      const entity of
      tweet.entities
    ) {
      entityCounts[entity] =
        (
          entityCounts[entity] ||
          0
        ) + 1;
    }

    for (
      const keyword of
      tweet.keywords
    ) {
      keywordCounts[keyword] =
        (
          keywordCounts[keyword] ||
          0
        ) + 1;
    }
  }

  const goodEntities =
    Object.entries(
      entityCounts
    )
      .filter(
        ([, count]) =>
          count >= 2
      )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
      .slice(0, 3)
      .map(
        ([entity]) =>
          entity
      );

  if (
    goodEntities.length
  ) {
    return goodEntities.join(
      " / "
    );
  }

  return Object.entries(
    keywordCounts
  )
    .sort(
      (a, b) =>
        b[1] - a[1]
    )
    .slice(0, 4)
    .map(
      ([keyword]) =>
        keyword
    )
    .join(" / ");
}

/*
|--------------------------------------------------------------------------
| NORMALIZE TWEET
|--------------------------------------------------------------------------
*/

function normalizeTweet(
  tweet,
  windowMinutes
) {
  const username =
    getUsername(tweet);

  const text =
    String(
      tweet?.text || ""
    );

  const likes =
    Number(
      tweet?.likeCount ??
      tweet?.like_count ??
      0
    ) || 0;

  const replies =
    Number(
      tweet?.replyCount ??
      tweet?.reply_count ??
      0
    ) || 0;

  const reposts =
    Number(
      tweet?.retweetCount ??
      tweet?.retweet_count ??
      0
    ) || 0;

  const quotes =
    Number(
      tweet?.quoteCount ??
      tweet?.quote_count ??
      0
    ) || 0;

  const views =
    Number(
      tweet?.viewCount ??
      tweet?.view_count ??
      0
    ) || 0;

  const createdAt =
    getCreatedAt(tweet);

  let ageMinutes =
    windowMinutes;

  if (createdAt) {
    const timestamp =
      new Date(
        createdAt
      ).getTime();

    if (
      !Number.isNaN(timestamp)
    ) {
      ageMinutes =
        Math.max(
          0.25,
          (
            Date.now() -
            timestamp
          ) /
          60000
        );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Weighted engagement
  |--------------------------------------------------------------------------
  */

  const engagement =
    likes +
    replies * 2 +
    reposts * 3 +
    quotes * 3;

  const velocity =
    engagement /
    Math.max(
      ageMinutes,
      0.25
    );

  /*
  |--------------------------------------------------------------------------
  | Early score
  |--------------------------------------------------------------------------
  */

  const earlyScore =
    velocity *
      ageBoost(ageMinutes) +
    Math.log10(
      views + 1
    );

  return {
    id:
      tweet.id,

    text,

    username,

    createdAt,

    ageMinutes:
      Number(
        ageMinutes.toFixed(2)
      ),

    likes,
    replies,
    reposts,
    quotes,
    views,

    engagement,

    velocity:
      Number(
        velocity.toFixed(2)
      ),

    earlyScore:
      Number(
        earlyScore.toFixed(2)
      ),

    keywords:
      extractKeywords(text),

    entities:
      extractEntities(text),

    url:
      tweet?.twitterUrl ||
      tweet?.url ||
      (
        username
          ? `https://x.com/${username}/status/${tweet.id}`
          : null
      )
  };
}

/*
|--------------------------------------------------------------------------
| MAIN API
|--------------------------------------------------------------------------
*/

module.exports =
async function handler(req, res) {
  try {
    const apiKey =
      process.env
        .TWITTER_API_KEY;

    if (!apiKey) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            "TWITTER_API_KEY missing"
        });
    }

    /*
    |--------------------------------------------------------------------------
    | QUERY SETTINGS
    |--------------------------------------------------------------------------
    */

    const minutes =
      clamp(
        req.query.minutes,
        5,
        1440,
        30
      );

    const limit =
      clamp(
        req.query.limit,
        1,
        30,
        15
      );

    /*
    |--------------------------------------------------------------------------
    | DEFAULT PAGES = 1
    |
    | Jangan dinaikkan dulu.
    |--------------------------------------------------------------------------
    */

    const pages =
      clamp(
        req.query.pages,
        1,
        2,
        1
      );

    const since =
      Math.floor(
        Date.now() / 1000
      ) -
      minutes * 60;

    /*
    |--------------------------------------------------------------------------
    | COLLECT SENSORS SEQUENTIALLY
    |--------------------------------------------------------------------------
    */

    const sensorResults = [];

    for (
      let i = 0;
      i < SENSORS.length;
      i++
    ) {
      const sensor =
        SENSORS[i];

      const result =
        await collectSensor(
          apiKey,
          sensor,
          since,
          pages
        );

      sensorResults.push(
        result
      );

      /*
      |--------------------------------------------------------------------------
      | Delay antar sensor.
      |--------------------------------------------------------------------------
      */

      if (
        i <
        SENSORS.length - 1
      ) {
        await sleep(5200);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | MERGE
    |--------------------------------------------------------------------------
    */

    const rawTweets =
      sensorResults.flatMap(
        (sensor) =>
          sensor.tweets
      );

    /*
    |--------------------------------------------------------------------------
    | DEDUPE
    |--------------------------------------------------------------------------
    */

    const uniqueMap =
      new Map();

    for (
      const tweet of
      rawTweets
    ) {
      if (!tweet?.id) {
        continue;
      }

      uniqueMap.set(
        tweet.id,
        tweet
      );
    }

    const uniqueTweets =
      Array.from(
        uniqueMap.values()
      );

    /*
    |--------------------------------------------------------------------------
    | NORMALIZE + FILTER
    |--------------------------------------------------------------------------
    */

    const processed =
      uniqueTweets
        .map(
          (tweet) =>
            normalizeTweet(
              tweet,
              minutes
            )
        )
        .filter(
          (tweet) =>
            !isNoise(
              tweet.text
            )
        )
        .filter(
          (tweet) => {
            /*
            |--------------------------------------------------------------------------
            | Super fresh tweets jangan terlalu keras difilter.
            |--------------------------------------------------------------------------
            */

            if (
              tweet.ageMinutes <= 2
            ) {
              return (
                tweet.engagement > 0 ||
                tweet.views >= 2
              );
            }

            if (
              tweet.ageMinutes <= 5
            ) {
              return (
                tweet.engagement > 0 ||
                tweet.views >= 5
              );
            }

            return (
              tweet.engagement > 0 ||
              tweet.views >= 20
            );
          }
        )
        .sort(
          (a, b) =>
            b.earlyScore -
            a.earlyScore
        );

    /*
    |--------------------------------------------------------------------------
    | BUILD NARRATIVES
    |--------------------------------------------------------------------------
    */

    const clusters =
      buildClusters(
        processed
      );

    const narratives =
      clusters
        .map(
          (cluster) => {
            const accounts =
              new Set(
                cluster
                  .map(
                    (tweet) =>
                      tweet.username
                  )
                  .filter(Boolean)
              );

            const uniqueAccounts =
              accounts.size;

            const mentions =
              cluster.length;

            const avgAge =
              cluster.reduce(
                (sum, tweet) =>
                  sum +
                  tweet.ageMinutes,
                0
              ) /
              mentions;

            const totalEngagement =
              cluster.reduce(
                (sum, tweet) =>
                  sum +
                  tweet.engagement,
                0
              );

            const totalViews =
              cluster.reduce(
                (sum, tweet) =>
                  sum +
                  tweet.views,
                0
              );

            const totalVelocity =
              cluster.reduce(
                (sum, tweet) =>
                  sum +
                  tweet.velocity,
                0
              );

            /*
            |--------------------------------------------------------------------------
            | RECENT MENTIONS
            |--------------------------------------------------------------------------
            */

            const recent5 =
              cluster.filter(
                (tweet) =>
                  tweet.ageMinutes <= 5
              ).length;

            const older =
              cluster.filter(
                (tweet) =>
                  tweet.ageMinutes > 5
              ).length;

            /*
            |--------------------------------------------------------------------------
            | BURST
            |--------------------------------------------------------------------------
            */

            const recentRate =
              recent5 / 5;

            const olderWindow =
              Math.max(
                minutes - 5,
                1
              );

            const olderRate =
              older /
              olderWindow;

            const burstRatio =
              olderRate > 0
                ? recentRate /
                  olderRate
                : recent5 > 0
                  ? 2
                  : 1;

            /*
            |--------------------------------------------------------------------------
            | ACCOUNT BOOST
            |--------------------------------------------------------------------------
            */

            let accountBoost = 1;

            if (
              uniqueAccounts >= 5
            ) {
              accountBoost = 4;
            } else if (
              uniqueAccounts >= 3
            ) {
              accountBoost = 2.7;
            } else if (
              uniqueAccounts >= 2
            ) {
              accountBoost = 1.8;
            }

            /*
            |--------------------------------------------------------------------------
            | AGE BOOST
            |--------------------------------------------------------------------------
            */

            let clusterAgeBoost = 1;

            if (avgAge <= 2) {
              clusterAgeBoost = 2.5;
            } else if (
              avgAge <= 5
            ) {
              clusterAgeBoost = 2;
            } else if (
              avgAge <= 10
            ) {
              clusterAgeBoost = 1.4;
            }

            /*
            |--------------------------------------------------------------------------
            | SCORE
            |--------------------------------------------------------------------------
            */

            const score =
              (
                totalVelocity +
                Math.log10(
                  totalViews + 1
                ) +
                mentions +
                Math.min(
                  burstRatio,
                  5
                )
              ) *
              accountBoost *
              clusterAgeBoost;

            /*
            |--------------------------------------------------------------------------
            | STATUS
            |--------------------------------------------------------------------------
            */

            let status =
              "WATCH";

            if (
              uniqueAccounts >= 2 &&
              avgAge <= 5
            ) {
              status =
                "EARLY";
            }

            if (
              uniqueAccounts >= 3 &&
              (
                score >= 25 ||
                burstRatio >= 2
              )
            ) {
              status =
                "RISING";
            }

            if (
              uniqueAccounts >= 5 &&
              score >= 70
            ) {
              status =
                "BREAKING";
            }

            return {
              narrative:
                makeNarrativeName(
                  cluster
                ),

              status,

              mentions,

              uniqueAccounts,

              recent5Minutes:
                recent5,

              avgAgeMinutes:
                Number(
                  avgAge.toFixed(2)
                ),

              engagement:
                totalEngagement,

              views:
                totalViews,

              velocity:
                Number(
                  totalVelocity.toFixed(2)
                ),

              burstRatio:
                Number(
                  burstRatio.toFixed(2)
                ),

              score:
                Number(
                  score.toFixed(2)
                ),

              topTweets:
                [...cluster]
                  .sort(
                    (a, b) =>
                      b.earlyScore -
                      a.earlyScore
                  )
                  .slice(0, 4)
                  .map(
                    (tweet) => ({
                      username:
                        tweet.username,

                      text:
                        tweet.text,

                      ageMinutes:
                        tweet.ageMinutes,

                      engagement:
                        tweet.engagement,

                      views:
                        tweet.views,

                      url:
                        tweet.url
                    })
                  )
            };
          }
        )

        /*
        |--------------------------------------------------------------------------
        | Butuh minimal dua akun berbeda supaya disebut narrative.
        |--------------------------------------------------------------------------
        */

        .filter(
          (narrative) =>
            narrative
              .uniqueAccounts >= 2
        )

        .sort(
          (a, b) =>
            b.score -
            a.score
        )

        .slice(
          0,
          limit
        );

    /*
    |--------------------------------------------------------------------------
    | SUPER EARLY SIGNALS
    |--------------------------------------------------------------------------
    */

    const signals =
      processed
        .filter(
          (tweet) =>
            tweet.ageMinutes <= 5
        )

        .sort(
          (a, b) =>
            b.earlyScore -
            a.earlyScore
        )

        .slice(
          0,
          15
        )

        .map(
          (tweet) => ({
            text:
              tweet.text,

            username:
              tweet.username,

            ageMinutes:
              tweet.ageMinutes,

            engagement:
              tweet.engagement,

            views:
              tweet.views,

            score:
              tweet.earlyScore,

            url:
              tweet.url
          })
        );

    /*
    |--------------------------------------------------------------------------
    | SENSOR DEBUG
    |--------------------------------------------------------------------------
    */

    const sensorStats =
      sensorResults.map(
        (sensor) => ({
          id:
            sensor.id,

          pages:
            sensor.pagesFetched,

          tweets:
            sensor.count,

          statuses:
            sensor.statuses,

          rateLimited:
            sensor.rateLimited,

          error:
            sensor.error
        })
      );

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res
      .status(200)
      .json({
        ok: true,

        mode:
          "narrative-radar-v3",

        windowMinutes:
          minutes,

        pagesRequested:
          pages,

        sensors:
          SENSORS.length,

        rawFetched:
          rawTweets.length,

        scanned:
          uniqueTweets.length,

        qualified:
          processed.length,

        narrativeCount:
          narratives.length,

        earlyNarrativeCount:
          narratives.filter(
            (item) =>
              item.status ===
                "EARLY" ||
              item.status ===
                "RISING" ||
              item.status ===
                "BREAKING"
          ).length,

        narratives,

        signals,

        sensorStats
      });
  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,

        mode:
          "narrative-radar-v3",

        error:
          String(error)
      });
  }
};