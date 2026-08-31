const API_URL =
  "https://api.twitterapi.io/twitter/user/followings";

/*
|--------------------------------------------------------------------------
| X RADAR — SMART GRAPH
|--------------------------------------------------------------------------
|
| Features:
| - Smart/KOL recent-following scanner
| - Batch scanning
| - TwitterAPI.io rate-limit protection
| - User field normalization
| - Smart-follow overlap detection
| - Early project scoring
| - Ultra Early <= 3 days
| - Ready for Telegram integration
|
| Narrative Radar v4 is NOT touched.
|--------------------------------------------------------------------------
*/

const SMART_SEEDS = [
  "0xngmi",
  "DefiIgnas",
  "Route2FI",
  "Dynamo_Patrick",
  "TheDeFinvestor",
  "blocmatesdotcom"
];

const SEEDS_PER_BATCH = 3;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function clamp(value, min, max, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(Math.max(n, min), max);
}

function numberField(user, ...fields) {
  for (const field of fields) {
    const value = Number(user?.[field]);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function stringField(user, ...fields) {
  for (const field of fields) {
    const value = user?.[field];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return "";
}

function accountAgeDays(createdAt) {
  if (!createdAt) {
    return null;
  }

  const timestamp =
    new Date(createdAt).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (Date.now() - timestamp) / 86400000
  );
}

/*
|--------------------------------------------------------------------------
| NORMALIZE TWITTER USER
|--------------------------------------------------------------------------
*/

function normalizeUser(user) {
  const username = stringField(
    user,
    "userName",
    "username",
    "screen_name"
  );

  const followers = numberField(
    user,
    "followers_count",
    "followersCount",
    "followers"
  );

  const following = numberField(
    user,
    "following_count",
    "followingCount",
    "following",
    "friends_count"
  );

  const statuses = numberField(
    user,
    "tweet_count",
    "statuses_count",
    "statusesCount"
  );

  const createdAt = stringField(
    user,
    "created_at",
    "createdAt"
  );

  return {
    username,

    name: stringField(
      user,
      "name"
    ),

    description: stringField(
      user,
      "description"
    ),

    followers,
    following,
    statuses,
    createdAt,

    verified:
      Boolean(user?.verified),

    id:
      user?.id ||
      user?.id_str ||
      null
  };
}

function looksInteresting(user) {
  if (!user.username) {
    return false;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| TWITTERAPI.IO
|--------------------------------------------------------------------------
*/

async function getRecentFollowings(
  apiKey,
  username,
  pageSize
) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "userName",
    username
  );

  url.searchParams.set(
    "pageSize",
    String(pageSize)
  );

  const response = await fetch(
    url.toString(),
    {
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json"
      }
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,

      error:
        data?.message ||
        data?.error ||
        `HTTP ${response.status}`,

      followings: []
    };
  }

  let followings = [];

  if (Array.isArray(data?.followings)) {
    followings =
      data.followings;
  } else if (
    Array.isArray(data?.data)
  ) {
    followings =
      data.data;
  } else if (
    Array.isArray(
      data?.data?.followings
    )
  ) {
    followings =
      data.data.followings;
  }

  return {
    ok: true,
    status: response.status,
    followings
  };
}

/*
|--------------------------------------------------------------------------
| ACCOUNT SCORE
|--------------------------------------------------------------------------
*/

function scoreAccount(account) {
  const ageDays =
    accountAgeDays(
      account.createdAt
    );

  /*
  |--------------------------------------------------------------------------
  | Base smart-follow score
  |--------------------------------------------------------------------------
  */

  let score =
    account.smartFollowerCount * 15;

  /*
  |--------------------------------------------------------------------------
  | ULTRA EARLY BOOST
  |--------------------------------------------------------------------------
  */

  if (ageDays !== null) {
    if (ageDays <= 3) {
      score += 40;
    } else if (ageDays <= 7) {
      score += 25;
    } else if (ageDays <= 30) {
      score += 15;
    } else if (ageDays <= 90) {
      score += 7;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Smaller-account early boost
  |--------------------------------------------------------------------------
  */

  if (
    account.followers > 0 &&
    account.followers < 1000
  ) {
    score += 8;
  } else if (
    account.followers >= 1000 &&
    account.followers < 5000
  ) {
    score += 4;
  }

  /*
  |--------------------------------------------------------------------------
  | Small verified boost
  |--------------------------------------------------------------------------
  */

  if (account.verified) {
    score += 2;
  }

  /*
  |--------------------------------------------------------------------------
  | SMART STATUS
  |--------------------------------------------------------------------------
  */

  let status = "WATCH";

  if (
    account.smartFollowerCount >= 2
  ) {
    status = "SMART SIGNAL";
  }

  if (
    account.smartFollowerCount >= 3
  ) {
    status = "SMART EARLY";
  }

  if (
    account.smartFollowerCount >= 5
  ) {
    status = "SMART CLUSTER";
  }

  /*
  |--------------------------------------------------------------------------
  | ULTRA EARLY STATUS
  |--------------------------------------------------------------------------
  */

  let ultraStatus = null;

  if (
    ageDays !== null &&
    ageDays <= 3
  ) {
    ultraStatus =
      "NEW WATCH";

    if (
      account.smartFollowerCount >= 2
    ) {
      ultraStatus =
        "NEW SMART SIGNAL";
    }

    if (
      account.smartFollowerCount >= 3
    ) {
      ultraStatus =
        "NEW SMART EARLY";
    }

    if (
      account.smartFollowerCount >= 5
    ) {
      ultraStatus =
        "NEW SMART CLUSTER";
    }
  }

  return {
    ...account,

    accountAgeDays:
      ageDays === null
        ? null
        : Number(
            ageDays.toFixed(2)
          ),

    smartScore:
      Number(
        score.toFixed(2)
      ),

    status,
    ultraStatus,

    url:
      `https://x.com/${account.username}`
  };
}

/*
|--------------------------------------------------------------------------
| MAIN HANDLER
|--------------------------------------------------------------------------
*/

module.exports =
async function handler(req, res) {
  try {
    const apiKey =
      process.env.TWITTER_API_KEY;

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
    | Page size
    |--------------------------------------------------------------------------
    */

    const pageSize =
      clamp(
        req.query.size,
        20,
        30,
        20
      );

    /*
    |--------------------------------------------------------------------------
    | Batch selection
    |--------------------------------------------------------------------------
    |
    | batch=1
    | 0xngmi
    | DefiIgnas
    | Route2FI
    |
    | batch=2
    | Dynamo_Patrick
    | TheDeFinvestor
    | blocmatesdotcom
    |
    */

    const maxBatch =
      Math.ceil(
        SMART_SEEDS.length /
        SEEDS_PER_BATCH
      );

    const requestedBatch =
      clamp(
        req.query.batch,
        1,
        maxBatch,
        1
      );

    const startIndex =
      (requestedBatch - 1) *
      SEEDS_PER_BATCH;

    const activeSeeds =
      SMART_SEEDS.slice(
        startIndex,
        startIndex +
          SEEDS_PER_BATCH
      );

    const graph =
      new Map();

    const seedStats = [];

    /*
    |--------------------------------------------------------------------------
    | SCAN ACTIVE SMART ACCOUNTS
    |--------------------------------------------------------------------------
    */

    for (
      let i = 0;
      i < activeSeeds.length;
      i++
    ) {
      const seed =
        activeSeeds[i];

      let result =
        await getRecentFollowings(
          apiKey,
          seed,
          pageSize
        );

      /*
      |--------------------------------------------------------------------------
      | Rate-limit retry
      |--------------------------------------------------------------------------
      */

      if (
        result.status === 429
      ) {
        await sleep(5200);

        result =
          await getRecentFollowings(
            apiKey,
            seed,
            pageSize
          );
      }

      seedStats.push({
        seed,

        status:
          result.status,

        found:
          result.followings.length,

        error:
          result.error || null
      });

      /*
      |--------------------------------------------------------------------------
      | Build graph
      |--------------------------------------------------------------------------
      */

      if (result.ok) {
        for (
          const rawUser of
          result.followings
        ) {
          const user =
            normalizeUser(
              rawUser
            );

          if (
            !looksInteresting(
              user
            )
          ) {
            continue;
          }

          const key =
            user.username
              .toLowerCase();

          if (
            !graph.has(key)
          ) {
            graph.set(
              key,
              {
                username:
                  user.username,

                name:
                  user.name,

                description:
                  user.description,

                followers:
                  user.followers,

                following:
                  user.following,

                statuses:
                  user.statuses,

                createdAt:
                  user.createdAt,

                verified:
                  user.verified,

                id:
                  user.id,

                smartFollowers:
                  [],

                smartFollowerCount:
                  0
              }
            );
          }

          const account =
            graph.get(key);

          if (
            !account
              .smartFollowers
              .includes(seed)
          ) {
            account
              .smartFollowers
              .push(seed);

            account
              .smartFollowerCount =
                account
                  .smartFollowers
                  .length;
          }
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Protect API QPS
      |--------------------------------------------------------------------------
      */

      if (
        i <
        activeSeeds.length - 1
      ) {
        await sleep(5200);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | SCORE EVERYTHING
    |--------------------------------------------------------------------------
    */

    const accounts =
      Array.from(
        graph.values()
      )
        .map(
          scoreAccount
        )

        .sort(
          (a, b) => {
            /*
             * Ultra Early first.
             */

            const aUltra =
              a.ultraStatus
                ? 1
                : 0;

            const bUltra =
              b.ultraStatus
                ? 1
                : 0;

            if (
              bUltra !==
              aUltra
            ) {
              return (
                bUltra -
                aUltra
              );
            }

            /*
             * More smart followers.
             */

            if (
              b.smartFollowerCount !==
              a.smartFollowerCount
            ) {
              return (
                b.smartFollowerCount -
                a.smartFollowerCount
              );
            }

            /*
             * Higher score.
             */

            return (
              b.smartScore -
              a.smartScore
            );
          }
        );

    /*
    |--------------------------------------------------------------------------
    | ULTRA EARLY
    |--------------------------------------------------------------------------
    |
    | Account <= 3 days old
    | AND followed by >= 1 smart account.
    |
    */

    const ultraEarly =
      accounts
        .filter(
          (account) =>
            account
              .accountAgeDays !==
              null &&
            account
              .accountAgeDays <=
              3 &&
            account
              .smartFollowerCount >=
              1
        )
        .slice(0, 30);

    /*
    |--------------------------------------------------------------------------
    | SMART CANDIDATES
    |--------------------------------------------------------------------------
    |
    | Followed by >= 2 smart accounts.
    |
    */

    const candidates =
      accounts
        .filter(
          (account) =>
            account
              .smartFollowerCount >=
              2
        )
        .slice(0, 30);

    /*
    |--------------------------------------------------------------------------
    | DISCOVERIES
    |--------------------------------------------------------------------------
    |
    | Followed by exactly one smart account.
    |
    */

    const discoveries =
      accounts
        .filter(
          (account) =>
            account
              .smartFollowerCount ===
              1
        )
        .slice(0, 30);

    /*
    |--------------------------------------------------------------------------
    | ALERT CANDIDATES
    |--------------------------------------------------------------------------
    |
    | Prepared for Telegram.
    |
    | Priority:
    | 1. Ultra Early <= 3 days
    | 2. Multiple smart followers
    |
    */

    const alertCandidates =
      accounts
        .filter(
          (account) =>
            account.ultraStatus ||
            account
              .smartFollowerCount >=
              2
        )
        .slice(0, 20);

    /*
    |--------------------------------------------------------------------------
    | Next batch
    |--------------------------------------------------------------------------
    */

    const nextBatch =
      requestedBatch >=
      maxBatch
        ? 1
        : requestedBatch + 1;

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
          "smart-graph-ultra-early",

        version:
          "1.0-final",

        batch:
          requestedBatch,

        totalBatches:
          maxBatch,

        nextBatch,

        seedsScanned:
          activeSeeds,

        recentFollowingsPerSeed:
          pageSize,

        uniqueAccountsScanned:
          graph.size,

        /*
        |--------------------------------------------------------------------------
        | Ultra Early
        |--------------------------------------------------------------------------
        */

        ultraEarlyCount:
          ultraEarly.length,

        ultraEarly,

        /*
        |--------------------------------------------------------------------------
        | Smart overlap
        |--------------------------------------------------------------------------
        */

        smartCandidates:
          candidates.length,

        candidates,

        /*
        |--------------------------------------------------------------------------
        | Single smart-follow discoveries
        |--------------------------------------------------------------------------
        */

        discoveriesCount:
          discoveries.length,

        discoveries,

        /*
        |--------------------------------------------------------------------------
        | Telegram-ready candidates
        |--------------------------------------------------------------------------
        */

        alertCandidatesCount:
          alertCandidates.length,

        alertCandidates,

        /*
        |--------------------------------------------------------------------------
        | Diagnostics
        |--------------------------------------------------------------------------
        */

        seedStats
      });

  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,

        mode:
          "smart-graph-ultra-early",

        error:
          String(error)
      });
  }
};