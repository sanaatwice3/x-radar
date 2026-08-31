const API_URL = "https://api.twitterapi.io/twitter/user/followings";

const SMART_SEEDS = [
  "0xngmi",
  "DefiIgnas",
  "Route2FI",
  "Dynamo_Patrick",
  "TheDeFinvestor",
  "blocmatesdotcom"
];

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
    if (
      typeof user?.[field] === "string" &&
      user[field].trim()
    ) {
      return user[field];
    }
  }

  return "";
}

function accountAgeDays(createdAt) {
  if (!createdAt) {
    return null;
  }

  const timestamp = new Date(createdAt).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (Date.now() - timestamp) / 86400000
  );
}

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

  /*
   * Jangan lagi buang akun cuma karena
   * metric tertentu tidak tersedia.
   */

  return true;
}

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

  /*
   * Support beberapa response shape.
   */

  let followings = [];

  if (Array.isArray(data?.followings)) {
    followings = data.followings;
  } else if (Array.isArray(data?.data)) {
    followings = data.data;
  } else if (
    Array.isArray(data?.data?.followings)
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

module.exports = async function handler(
  req,
  res
) {
  try {
    const apiKey =
      process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error:
          "TWITTER_API_KEY missing"
      });
    }

    const pageSize = clamp(
      req.query.size,
      20,
      30,
      20
    );

    const requestedBatch =
      Number(req.query.batch) === 2
        ? 2
        : 1;

    const startIndex =
      requestedBatch === 1
        ? 0
        : 3;

    const activeSeeds =
      SMART_SEEDS.slice(
        startIndex,
        startIndex + 3
      );

    const graph = new Map();
    const seedStats = [];

    for (
      let i = 0;
      i < activeSeeds.length;
      i++
    ) {
      const seed = activeSeeds[i];

      let result =
        await getRecentFollowings(
          apiKey,
          seed,
          pageSize
        );

      if (result.status === 429) {
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
        status: result.status,
        found:
          result.followings.length,
        error:
          result.error || null
      });

      if (result.ok) {
        for (
          const rawUser of
          result.followings
        ) {
          const user =
            normalizeUser(rawUser);

          if (!looksInteresting(user)) {
            continue;
          }

          const key =
            user.username.toLowerCase();

          if (!graph.has(key)) {
            graph.set(key, {
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

              smartFollowers: [],

              smartFollowerCount: 0
            });
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

            account.smartFollowerCount =
              account
                .smartFollowers
                .length;
          }
        }
      }

      if (
        i <
        activeSeeds.length - 1
      ) {
        await sleep(5200);
      }
    }

    const accounts =
      Array.from(
        graph.values()
      )
        .map((account) => {
          const ageDays =
            accountAgeDays(
              account.createdAt
            );

          let score =
            account
              .smartFollowerCount *
            15;

          /*
           * Account baru.
           */

          if (ageDays !== null) {
            if (ageDays <= 7) {
              score += 25;
            } else if (
              ageDays <= 30
            ) {
              score += 15;
            } else if (
              ageDays <= 90
            ) {
              score += 7;
            }
          }

          /*
           * Project kecil / early.
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
           * Tiny verified boost.
           */

          if (account.verified) {
            score += 2;
          }

          let status = "WATCH";

          if (
            account
              .smartFollowerCount >= 2
          ) {
            status =
              "SMART SIGNAL";
          }

          if (
            account
              .smartFollowerCount >= 3
          ) {
            status =
              "SMART EARLY";
          }

          return {
            ...account,

            accountAgeDays:
              ageDays === null
                ? null
                : Number(
                    ageDays.toFixed(1)
                  ),

            smartScore:
              Number(
                score.toFixed(2)
              ),

            status,

            url:
              `https://x.com/${account.username}`
          };
        })

        .sort(
          (a, b) =>
            b.smartScore -
            a.smartScore
        );

    const candidates =
      accounts
        .filter(
          (account) =>
            account
              .smartFollowerCount >= 2
        )
        .slice(0, 30);

    const discoveries =
      accounts
        .filter(
          (account) =>
            account
              .smartFollowerCount === 1
        )
        .slice(0, 30);

    return res.status(200).json({
      ok: true,

      mode:
        "smart-graph-fast-fixed",

      batch:
        requestedBatch,

      seedsScanned:
        activeSeeds,

      recentFollowingsPerSeed:
        pageSize,

      uniqueAccountsScanned:
        graph.size,

      smartCandidates:
        candidates.length,

      discoveriesCount:
        discoveries.length,

      candidates,

      discoveries,

      seedStats,

      nextBatch:
        requestedBatch === 1
          ? 2
          : 1
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,

      mode:
        "smart-graph-fast-fixed",

      error:
        String(error)
    });
  }
};