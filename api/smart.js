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

function accountAgeDays(createdAt) {
  if (!createdAt) return null;

  const timestamp = new Date(createdAt).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (Date.now() - timestamp) / 86400000
  );
}

function looksInteresting(user) {
  if (!user?.userName) return false;

  if (user.unavailable) return false;

  const followers = Number(user.followers) || 0;
  const following = Number(user.following) || 0;
  const statuses = Number(user.statusesCount) || 0;

  if (
    followers === 0 &&
    following === 0 &&
    statuses === 0
  ) {
    return false;
  }

  return true;
}

async function getRecentFollowings(
  apiKey,
  username,
  pageSize
) {
  const url = new URL(API_URL);

  url.searchParams.set("userName", username);
  url.searchParams.set("pageSize", String(pageSize));

  const response = await fetch(url.toString(), {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json"
    }
  });

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

  return {
    ok: true,
    status: response.status,
    followings: Array.isArray(data?.followings)
      ? data.followings
      : []
  };
}

module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "TWITTER_API_KEY missing"
      });
    }

    const pageSize = clamp(
      req.query.size,
      20,
      30,
      20
    );

    /*
    |--------------------------------------------------------------------------
    | BATCH MODE
    |--------------------------------------------------------------------------
    |
    | batch=1 -> seed 1,2,3
    | batch=2 -> seed 4,5,6
    |
    */

    const requestedBatch =
      Number(req.query.batch) === 2 ? 2 : 1;

    const startIndex =
      requestedBatch === 1 ? 0 : 3;

    const activeSeeds = SMART_SEEDS.slice(
      startIndex,
      startIndex + 3
    );

    const graph = new Map();
    const seedStats = [];

    for (let i = 0; i < activeSeeds.length; i++) {
      const seed = activeSeeds[i];

      let result = await getRecentFollowings(
        apiKey,
        seed,
        pageSize
      );

      if (result.status === 429) {
        await sleep(5200);

        result = await getRecentFollowings(
          apiKey,
          seed,
          pageSize
        );
      }

      seedStats.push({
        seed,
        status: result.status,
        found: result.followings.length,
        error: result.error || null
      });

      if (result.ok) {
        for (const user of result.followings) {
          if (!looksInteresting(user)) {
            continue;
          }

          const key = String(
            user.userName
          ).toLowerCase();

          if (!graph.has(key)) {
            graph.set(key, {
              username: user.userName,
              name: user.name || "",
              description: user.description || "",

              followers:
                Number(user.followers) || 0,

              following:
                Number(user.following) || 0,

              createdAt:
                user.createdAt || null,

              smartFollowers: [],
              smartFollowerCount: 0
            });
          }

          const item = graph.get(key);

          if (
            !item.smartFollowers.includes(seed)
          ) {
            item.smartFollowers.push(seed);

            item.smartFollowerCount =
              item.smartFollowers.length;
          }
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Hanya dua delay maksimal per request.
      |--------------------------------------------------------------------------
      */

      if (i < activeSeeds.length - 1) {
        await sleep(5200);
      }
    }

    const accounts = Array.from(graph.values())
      .map((account) => {
        const ageDays = accountAgeDays(
          account.createdAt
        );

        let score =
          account.smartFollowerCount * 15;

        if (ageDays !== null) {
          if (ageDays <= 7) {
            score += 25;
          } else if (ageDays <= 30) {
            score += 15;
          } else if (ageDays <= 90) {
            score += 7;
          }
        }

        if (account.followers < 1000) {
          score += 8;
        } else if (account.followers < 5000) {
          score += 4;
        }

        let status = "WATCH";

        if (account.smartFollowerCount >= 2) {
          status = "SMART SIGNAL";
        }

        if (account.smartFollowerCount >= 3) {
          status = "SMART EARLY";
        }

        return {
          ...account,

          accountAgeDays:
            ageDays === null
              ? null
              : Number(ageDays.toFixed(1)),

          smartScore:
            Number(score.toFixed(2)),

          status,

          url:
            `https://x.com/${account.username}`
        };
      })
      .sort(
        (a, b) =>
          b.smartScore - a.smartScore
      );

    /*
    |--------------------------------------------------------------------------
    | Kandidat overlap.
    |--------------------------------------------------------------------------
    */

    const candidates = accounts
      .filter(
        (account) =>
          account.smartFollowerCount >= 2
      )
      .slice(0, 30);

    /*
    |--------------------------------------------------------------------------
    | Early discoveries.
    |--------------------------------------------------------------------------
    |
    | Walau baru di-follow 1 smart account,
    | tetap tampil supaya nanti Telegram bisa track.
    |--------------------------------------------------------------------------
    */

    const discoveries = accounts
      .filter(
        (account) =>
          account.smartFollowerCount === 1
      )
      .slice(0, 30);

    return res.status(200).json({
      ok: true,

      mode: "smart-graph-fast",

      batch: requestedBatch,

      seedsScanned: activeSeeds,

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
        requestedBatch === 1 ? 2 : 1
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mode: "smart-graph-fast",
      error: String(error)
    });
  }
};