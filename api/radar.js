const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

const STOP_WORDS = new Set([
  "this","that","with","from","have","will","your","what","when","where",
  "about","they","their","there","would","could","should","just","been",
  "into","more","than","some","very","here","were","them","then","also",
  "only","over","after","before","because","while","really","still",
  "going","make","made","today","right","people","thing","things","like",
  "said","says","saying","breaking","viral","trending","news","update",
  "thread","watch","look","https","http","the","and","for","are","was",
  "you","but","not","all","can","out","has","had","its","our","who",
  "how","why","now","new","get","got","one","two","too"
]);

const BLOCKED_PHRASES = [
  "join telegram",
  "telegram group",
  "signal group",
  "private alpha",
  "contract address",
  "drop your wallet",
  "send wallet",
  "whitelist spot",
  "presale",
  "100x",
  "1000x",
  "buy now",
  "dm me",
  "stay locked in",
  "call channel",
  "paid group"
];

const DISCOVERY_QUERIES = [
  "breaking OR confirmed OR announced OR launch",
  "viral OR trending OR controversy OR scandal OR drama",
  "meme OR funny OR weird OR absurd OR insane",
  "crypto OR blockchain OR web3 OR nft OR defi OR stablecoin",
  "mainnet OR testnet OR protocol OR network OR chain OR rollup",
  "listing OR partnership OR acquisition OR funding OR investment",
  "exchange OR wallet OR dex OR bridge OR prediction market",
  "AI OR OpenAI OR technology OR robot OR startup",
  "CEO OR founder OR president OR politician OR government",
  "celebrity OR streamer OR gaming OR sports",
  "market OR stock OR ETF OR treasury OR institutional",
  "Elon OR Musk OR Trump OR Robinhood OR Coinbase OR Binance"
];

function clamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function normalizeTweets(data) {
  return (
    data?.tweets ||
    data?.data?.tweets ||
    data?.data ||
    []
  );
}

async function searchPage(apiKey, query, since, cursor = null) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
  );

  url.searchParams.set("queryType", "Latest");

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey
    }
  });

  if (!response.ok) {
    return {
      tweets: [],
      cursor: null
    };
  }

  const data = await response.json();

  return {
    tweets: normalizeTweets(data),
    cursor:
      data?.next_cursor ||
      data?.nextCursor ||
      data?.cursor?.next ||
      null
  };
}

async function searchSensor(
  apiKey,
  query,
  since,
  pages = 2
) {
  const tweets = [];
  let cursor = null;

  for (let i = 0; i < pages; i++) {
    const page = await searchPage(
      apiKey,
      query,
      since,
      cursor
    );

    tweets.push(...page.tweets);

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return tweets;
}

function cleanText(text = "") {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyReply(text = "") {
  return text.trim().startsWith("@");
}

function hasCryptoAddress(text = "") {
  const evm =
    /\b0x[a-fA-F0-9]{40}\b/;

  const solana =
    /\b[1-9A-HJ-NP-Za-km-z]{32,44}(?:pump)?\b/;

  return (
    evm.test(text) ||
    solana.test(text)
  );
}

function isNoise(text = "") {
  const t = text.toLowerCase().trim();

  if (!t) return true;

  if (isLikelyReply(t)) {
    return true;
  }

  if (
    BLOCKED_PHRASES.some((x) =>
      t.includes(x)
    )
  ) {
    return true;
  }

  if (
    t.includes("ca:") ||
    t.includes("contract:")
  ) {
    return true;
  }

  if (
    hasCryptoAddress(text) &&
    (
      t.includes("moon") ||
      t.includes("mc") ||
      t.includes("entry") ||
      t.includes("ape")
    )
  ) {
    return true;
  }

  if (
    cleanText(text).length < 18
  ) {
    return true;
  }

  return false;
}

function ageBoost(ageMinutes) {
  if (ageMinutes <= 1) return 5;
  if (ageMinutes <= 2) return 4;
  if (ageMinutes <= 5) return 3;
  if (ageMinutes <= 10) return 2;
  if (ageMinutes <= 20) return 1.3;
  return 1;
}

function extractKeywords(text = "") {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(
      /[^\p{L}\p{N}#$\s]/gu,
      " "
    )
    .toLowerCase();

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 3)
    .filter((word) => !STOP_WORDS.has(word));

  const unique = [];

  for (const word of words) {
    if (!unique.includes(word)) {
      unique.push(word);
    }

    if (unique.length >= 18) {
      break;
    }
  }

  return unique;
}

function extractPhrases(text = "") {
  const raw = cleanText(text)
    .replace(/@\w+/g, " ");

  const matches = [];

  const caps =
    raw.match(
      /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g
    ) || [];

  const tickers =
    raw.match(
      /\$[A-Za-z][A-Za-z0-9]{1,10}/g
    ) || [];

  const hashtags =
    raw.match(
      /#[A-Za-z][A-Za-z0-9_]{2,30}/g
    ) || [];

  for (const x of [
    ...caps,
    ...tickers,
    ...hashtags
  ]) {
    const value = x
      .trim()
      .toLowerCase();

    if (
      value.length >= 3 &&
      !matches.includes(value)
    ) {
      matches.push(value);
    }
  }

  return matches.slice(0, 10);
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);

  if (!A.size || !B.size) {
    return 0;
  }

  let intersection = 0;

  for (const x of A) {
    if (B.has(x)) {
      intersection++;
    }
  }

  const union =
    new Set([...A, ...B]).size;

  return intersection / union;
}

function phraseOverlap(a, b) {
  return a.some(
    (x) =>
      b.includes(x) &&
      x.length >= 4
  );
}

function strongKeywordOverlap(a, b) {
  const shared = a.filter(
    (x) => b.includes(x)
  );

  return shared.length >= 2;
}

function canCluster(a, b) {
  if (
    phraseOverlap(
      a.phrases,
      b.phrases
    )
  ) {
    return true;
  }

  if (
    strongKeywordOverlap(
      a.keywords,
      b.keywords
    )
  ) {
    return true;
  }

  return (
    jaccard(
      a.keywords,
      b.keywords
    ) >= 0.22
  );
}

function buildClusters(tweets) {
  const clusters = [];

  for (const tweet of tweets) {
    let bestIndex = -1;
    let bestScore = 0;

    for (
      let i = 0;
      i < clusters.length;
      i++
    ) {
      const cluster = clusters[i];

      for (const member of cluster) {
        if (!canCluster(tweet, member)) {
          continue;
        }

        const score =
          jaccard(
            tweet.keywords,
            member.keywords
          );

        if (
          score > bestScore ||
          bestIndex === -1
        ) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    if (bestIndex >= 0) {
      clusters[bestIndex].push(tweet);
    } else {
      clusters.push([tweet]);
    }
  }

  return clusters;
}

function makeNarrativeName(cluster) {
  const phraseCounts = {};
  const keywordCounts = {};

  for (const tweet of cluster) {
    for (const phrase of tweet.phrases) {
      phraseCounts[phrase] =
        (phraseCounts[phrase] || 0) + 1;
    }

    for (const word of tweet.keywords) {
      keywordCounts[word] =
        (keywordCounts[word] || 0) + 1;
    }
  }

  const bestPhrase =
    Object.entries(phraseCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }

        return b[0].length - a[0].length;
      })[0]?.[0];

  if (bestPhrase) {
    return bestPhrase;
  }

  const bestWords =
    Object.entries(keywordCounts)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }

        return b[0].length - a[0].length;
      })
      .slice(0, 4)
      .map(([word]) => word);

  return (
    bestWords.join(" ") ||
    "unknown narrative"
  );
}

function getTweetMetrics(tweet, minutes) {
  const author =
    tweet.author ||
    tweet.user ||
    {};

  const username =
    author.userName ||
    author.username ||
    tweet.userName ||
    "";

  const likes =
    Number(tweet.likeCount) || 0;

  const replies =
    Number(tweet.replyCount) || 0;

  const reposts =
    Number(tweet.retweetCount) || 0;

  const quotes =
    Number(tweet.quoteCount) || 0;

  const views =
    Number(tweet.viewCount) || 0;

  const createdAt =
    tweet.createdAt || null;

  let ageMinutes = minutes;

  if (createdAt) {
    const timestamp =
      new Date(createdAt).getTime();

    if (
      !Number.isNaN(timestamp)
    ) {
      ageMinutes = Math.max(
        0.25,
        (
          Date.now() -
          timestamp
        ) / 60000
      );
    }
  }

  const engagement =
    likes +
    replies * 2 +
    reposts * 3 +
    quotes * 3;

  const velocity =
    engagement / ageMinutes;

  const earlyScore =
    velocity *
      ageBoost(ageMinutes) +
    Math.log10(views + 1);

  const text =
    tweet.text || "";

  return {
    id: tweet.id,
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
    phrases:
      extractPhrases(text),
    url:
      tweet.twitterUrl ||
      tweet.url ||
      (
        username
          ? `https://x.com/${username}/status/${tweet.id}`
          : null
      )
  };
}

function narrativeStatus({
  uniqueAccounts,
  avgAge,
  score,
  mentions
}) {
  if (
    uniqueAccounts >= 5 &&
    score >= 80
  ) {
    return "BREAKING";
  }

  if (
    uniqueAccounts >= 3 &&
    score >= 25
  ) {
    return "RISING";
  }

  if (
    uniqueAccounts >= 2 &&
    avgAge <= 5
  ) {
    return "EARLY";
  }

  if (
    mentions >= 2
  ) {
    return "WATCH";
  }

  return "SINGLE";
}

module.exports = async function (req, res) {
  try {
    const apiKey =
      process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          "TWITTER_API_KEY missing"
      });
    }

    const minutes = clamp(
      req.query.minutes,
      5,
      1440,
      30
    );

    const limit = clamp(
      req.query.limit,
      1,
      50,
      20
    );

    const pagesPerSensor = clamp(
      req.query.pages,
      1,
      3,
      2
    );

    const since =
      Math.floor(
        Date.now() / 1000
      ) -
      minutes * 60;

    const groups =
      await Promise.all(
        DISCOVERY_QUERIES.map(
          (query) =>
            searchSensor(
              apiKey,
              query,
              since,
              pagesPerSensor
            )
        )
      );

    const unique =
      Array.from(
        new Map(
          groups
            .flat()
            .map((tweet) => [
              tweet.id,
              tweet
            ])
        ).values()
      );

    const processed =
      unique
        .map((tweet) =>
          getTweetMetrics(
            tweet,
            minutes
          )
        )
        .filter(
          (tweet) =>
            !isNoise(tweet.text)
        )
        .filter((tweet) => {
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
        })
        .sort(
          (a, b) =>
            b.earlyScore -
            a.earlyScore
        );

    const clusters =
      buildClusters(processed);

    const narratives =
      clusters
        .map((cluster) => {
          const uniqueAccounts =
            new Set(
              cluster
                .map(
                  (tweet) =>
                    tweet.username
                )
                .filter(Boolean)
            ).size;

          const mentions =
            cluster.length;

          const avgAge =
            cluster.reduce(
              (sum, tweet) =>
                sum +
                tweet.ageMinutes,
              0
            ) / mentions;

          const engagement =
            cluster.reduce(
              (sum, tweet) =>
                sum +
                tweet.engagement,
              0
            );

          const views =
            cluster.reduce(
              (sum, tweet) =>
                sum +
                tweet.views,
              0
            );

          const velocity =
            cluster.reduce(
              (sum, tweet) =>
                sum +
                tweet.velocity,
              0
            );

          let accountBoost = 1;

          if (
            uniqueAccounts >= 2
          ) {
            accountBoost = 1.8;
          }

          if (
            uniqueAccounts >= 3
          ) {
            accountBoost = 2.8;
          }

          if (
            uniqueAccounts >= 5
          ) {
            accountBoost = 4;
          }

          let burstBoost = 1;

          if (avgAge <= 2) {
            burstBoost = 3;
          } else if (
            avgAge <= 5
          ) {
            burstBoost = 2;
          } else if (
            avgAge <= 10
          ) {
            burstBoost = 1.4;
          }

          const score =
            (
              velocity +
              Math.log10(views + 1) +
              mentions
            ) *
            accountBoost *
            burstBoost;

          const status =
            narrativeStatus({
              uniqueAccounts,
              avgAge,
              score,
              mentions
            });

          const topTweets =
            [...cluster]
              .sort(
                (a, b) =>
                  b.earlyScore -
                  a.earlyScore
              )
              .slice(0, 4)
              .map((tweet) => ({
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
                score:
                  tweet.earlyScore,
                url:
                  tweet.url
              }));

          return {
            narrative:
              makeNarrativeName(
                cluster
              ),
            status,
            mentions,
            uniqueAccounts,
            avgAgeMinutes:
              Number(
                avgAge.toFixed(2)
              ),
            engagement,
            views,
            velocity:
              Number(
                velocity.toFixed(2)
              ),
            score:
              Number(
                score.toFixed(2)
              ),
            topTweets
          };
        })
        .filter(
          (narrative) =>
            narrative.uniqueAccounts >= 2
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(0, limit);

    const singles =
      processed
        .filter(
          (tweet) =>
            tweet.ageMinutes <= 5
        )
        .filter(
          (tweet) =>
            tweet.earlyScore >= 1
        )
        .slice(0, 15)
        .map((tweet) => ({
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
        }));

    const earlyNarratives =
      narratives.filter(
        (narrative) =>
          [
            "EARLY",
            "RISING",
            "BREAKING"
          ].includes(
            narrative.status
          )
      );

    return res
      .status(200)
      .json({
        ok: true,

        mode:
          "full-narrative-radar",

        windowMinutes:
          minutes,

        sensors:
          DISCOVERY_QUERIES.length,

        pagesPerSensor,

        scanned:
          unique.length,

        qualified:
          processed.length,

        narrativeCount:
          narratives.length,

        earlyNarrativeCount:
          earlyNarratives.length,

        narratives,

        signals:
          singles
      });

  } catch (error) {
    return res
      .status(500)
      .json({
        error:
          String(error)
      });
  }
};