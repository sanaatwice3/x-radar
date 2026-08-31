const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";


async function search(apiKey, query, since) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
  );

  url.searchParams.set(
    "queryType",
    "Latest"
  );

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  return (
    data.tweets ||
    data.data?.tweets ||
    []
  );
}


function isNoise(text = "") {
  const t = text
    .toLowerCase()
    .trim();

  if (!t) return true;

  // buang reply biasa
  if (t.startsWith("@")) {
    return true;
  }

  const blocked = [
    "good morning",
    "gmorning",
    "contract address",
    "ca:",
    "join telegram",
    "telegram group",
    "signal group",
    "presale",
    "100x",
    "1000x",
    "buy now",
    "dm me",
    "stay locked in",
    "drop your wallet",
    "send wallet",
    "whitelist spot"
  ];

  return blocked.some(
    (word) => t.includes(word)
  );
}


function ageBoost(ageMinutes) {
  if (ageMinutes <= 1) return 5;
  if (ageMinutes <= 2) return 4;
  if (ageMinutes <= 5) return 3;
  if (ageMinutes <= 10) return 2;
  if (ageMinutes <= 20) return 1.3;

  return 1;
}


const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "will",
  "your",
  "what",
  "when",
  "where",
  "about",
  "they",
  "their",
  "there",
  "would",
  "could",
  "should",
  "just",
  "been",
  "into",
  "more",
  "than",
  "some",
  "very",
  "here",
  "were",
  "them",
  "then",
  "also",
  "only",
  "over",
  "after",
  "before",
  "because",
  "while",
  "really",
  "still",
  "going",
  "make",
  "made",
  "today",
  "right",
  "people",
  "thing",
  "things",
  "like",
  "said",
  "says",
  "saying",
  "breaking",
  "viral",
  "trending",
  "news",
  "update",
  "thread",
  "watch",
  "look",
  "https",
  "http"
]);


function extractKeywords(text = "") {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(/[^\p{L}\p{N}#$\s]/gu, " ")
    .toLowerCase();

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean);

  const result = [];

  for (const word of words) {
    if (word.length < 4) continue;
    if (STOP_WORDS.has(word)) continue;

    result.push(word);
  }

  return [...new Set(result)]
    .slice(0, 12);
}


function similarity(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);

  if (!setA.size || !setB.size) {
    return 0;
  }

  let shared = 0;

  for (const word of setA) {
    if (setB.has(word)) {
      shared++;
    }
  }

  const union =
    new Set([
      ...setA,
      ...setB
    ]).size;

  return union
    ? shared / union
    : 0;
}


function hasStrongMatch(a, b) {
  const specialA = a.filter(
    (x) =>
      x.startsWith("$") ||
      x.startsWith("#")
  );

  if (
    specialA.some(
      (x) => b.includes(x)
    )
  ) {
    return true;
  }

  const shared = a.filter(
    (x) => b.includes(x)
  );

  return shared.length >= 2;
}


function makeTitle(cluster) {
  const counts = {};

  for (const tweet of cluster) {
    for (const keyword of tweet.keywords) {
      counts[keyword] =
        (counts[keyword] || 0) + 1;
    }
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }

      return b[0].length - a[0].length;
    })
    .filter(([, count]) => count >= 2)
    .slice(0, 4)
    .map(([word]) => word);

  if (!sorted.length) {
    return cluster[0]
      ?.keywords
      ?.slice(0, 3)
      .join(" ") || "unknown";
  }

  return sorted.join(" ");
}


function buildClusters(tweets) {
  const clusters = [];

  for (const tweet of tweets) {
    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      for (const member of cluster) {
        const score = similarity(
          tweet.keywords,
          member.keywords
        );

        const strong =
          hasStrongMatch(
            tweet.keywords,
            member.keywords
          );

        if (
          strong ||
          score >= 0.28
        ) {
          if (score > bestScore) {
            bestScore = score;
            bestCluster = cluster;
          }

          if (!bestCluster && strong) {
            bestCluster = cluster;
          }
        }
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


    const minutes = Math.min(
      Math.max(
        Number(req.query.minutes) || 30,
        5
      ),
      1440
    );


    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 20,
        1
      ),
      50
    );


    const since =
      Math.floor(
        Date.now() / 1000
      ) -
      minutes * 60;


    /*
      Ini cuma discovery sensors.

      Nama project / chain TIDAK perlu
      terdaftar di sini.

      Sensor mencari area percakapan luas,
      lalu clustering di bawah menemukan
      nama / narasi baru secara dinamis.
    */

    const queries = [
      "breaking OR viral OR trending OR controversy",
      "launch OR announced OR announcement OR confirmed",
      "mainnet OR testnet OR blockchain OR protocol OR network",
      "crypto OR web3 OR nft OR defi OR stablecoin",
      "AI OR technology OR startup OR acquisition OR funding",
      "market OR stock OR company OR CEO OR founder",
      "meme OR funny OR weird OR insane OR drama",
      "president OR election OR government OR politician",
      "celebrity OR streamer OR gaming OR sports"
    ];


    const groups =
      await Promise.all(
        queries.map((query) =>
          search(
            apiKey,
            query,
            since
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
        .map((tweet) => {
          const author =
            tweet.author ||
            tweet.user ||
            {};

          const username =
            author.userName ||
            author.username ||
            tweet.userName ||
            "";

          const text =
            tweet.text || "";

          const likes =
            Number(
              tweet.likeCount
            ) || 0;

          const replies =
            Number(
              tweet.replyCount
            ) || 0;

          const reposts =
            Number(
              tweet.retweetCount
            ) || 0;

          const quotes =
            Number(
              tweet.quoteCount
            ) || 0;

          const views =
            Number(
              tweet.viewCount
            ) || 0;

          const createdAt =
            tweet.createdAt ||
            null;


          let ageMinutes =
            minutes;


          if (createdAt) {
            const timestamp =
              new Date(
                createdAt
              ).getTime();

            if (
              !Number.isNaN(
                timestamp
              )
            ) {
              ageMinutes =
                Math.max(
                  1,
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
            engagement /
            ageMinutes;


          const boost =
            ageBoost(
              ageMinutes
            );


          const viewSignal =
            Math.log10(
              views + 1
            );


          const earlyScore =
            velocity *
              boost +
            viewSignal;


          return {
            id: tweet.id,
            text,
            username,
            createdAt,

            ageMinutes:
              Number(
                ageMinutes.toFixed(1)
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
              extractKeywords(
                text
              ),

            url:
              tweet.twitterUrl ||
              tweet.url ||
              (
                username
                  ? `https://x.com/${username}/status/${tweet.id}`
                  : null
              )
          };
        })


        .filter(
          (tweet) =>
            !isNoise(
              tweet.text
            )
        )


        /*
          Kita jangan terlalu ketat.

          Tweet baru umur 1 menit
          kadang views/likes masih kecil.
        */

        .filter(
          (tweet) =>
            tweet.engagement > 0 ||
            tweet.views >= 20
        );


    /*
      Tweet dengan earlyScore tinggi
      diproses dulu supaya cluster
      penting terbentuk lebih cepat.
    */

    processed.sort(
      (a, b) =>
        b.earlyScore -
        a.earlyScore
    );


    const clusters =
      buildClusters(
        processed
      );


    const narratives =
      clusters
        .map((cluster) => {

          const accounts =
            new Set(
              cluster
                .map(
                  (tweet) =>
                    tweet.username
                )
                .filter(Boolean)
            );


          const mentions =
            cluster.length;


          const uniqueAccounts =
            accounts.size;


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
            Multi account boost.

            2 akun = sinyal awal
            3+ akun = jauh lebih menarik
          */

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


          /*
            Burst boost.

            Narasi yang baru lahir
            dalam <= 5 menit diberi
            prioritas besar.
          */

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


          const narrativeScore =
            (
              totalVelocity +
              Math.log10(
                totalViews + 1
              ) +
              mentions
            ) *
            accountBoost *
            burstBoost;


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
            narrativeScore >= 25
          ) {
            status =
              "RISING";
          }


          if (
            uniqueAccounts >= 5 &&
            narrativeScore >= 80
          ) {
            status =
              "BREAKING";
          }


          const topTweets =
            [...cluster]
              .sort(
                (a, b) =>
                  b.earlyScore -
                  a.earlyScore
              )
              .slice(0, 3)
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

                url:
                  tweet.url
              }));


          return {
            narrative:
              makeTitle(
                cluster
              ),

            status,

            mentions,

            uniqueAccounts,

            avgAgeMinutes:
              Number(
                avgAge.toFixed(1)
              ),

            engagement:
              totalEngagement,

            views:
              totalViews,

            velocity:
              Number(
                totalVelocity.toFixed(2)
              ),

            score:
              Number(
                narrativeScore.toFixed(2)
              ),

            topTweets
          };
        })


        /*
          Narrative minimal:
          dua tweet / dua akun berbeda.

          Ini mengurangi tweet random.
        */

        .filter(
          (narrative) =>
            narrative.uniqueAccounts >= 2
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
      Super early signals.

      Ini penting karena narasi baru
      mungkin BELUM punya 2 akun.

      Jadi kita tetap kasih kandidat
      individual yang sangat baru.
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
        .slice(0, 10)
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


    return res
      .status(200)
      .json({
        ok: true,

        mode:
          "dynamic-narrative",

        windowMinutes:
          minutes,

        sensors:
          queries.length,

        scanned:
          unique.length,

        qualified:
          processed.length,

        narrativeCount:
          narratives.length,

        narratives,

        signals
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