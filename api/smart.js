const API_URL = "https://api.twitterapi.io/twitter/user/followings";

/*
|--------------------------------------------------------------------------
| SMART GRAPH V1
|--------------------------------------------------------------------------
| Mesin tambahan untuk mendeteksi account/project yang mulai di-follow
| oleh beberapa smart account.
|
| Narrative Radar v4 TIDAK disentuh.
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
  if (!user?.userName) {
    return false;
  }

  const followers = Number(user.followers) || 0;
  const following = Number(user.following) || 0;
  const statuses = Number(user.statusesCount) || 0;

  // Buang akun kosong / unavailable.
  if (
    followers === 0 &&
    following === 0 &&
    statuses === 0
  ) {
    return false;
  }

  if (user.unavailable) {
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

    /*
    |--------------------------------------------------------------------------
    | Default 20 recent followings per smart account.
    | Sengaja kecil supaya lebih hemat credit.
    |--------------------------------------------------------------------------
    */

    const pageSize = clamp(
      req.query.size,
      20,
      50,
      20
    );

    const graph = new Map();
    const seedStats = [];

    /*
    |--------------------------------------------------------------------------
    | FETCH SEQUENTIAL
    |--------------------------------------------------------------------------
    | Jangan Promise.all karena account TwitterAPI.io kita sebelumnya
    | kena rate limit kalau request paralel.
    |--------------------------------------------------------------------------
    */

    for (let i = 0; i < SMART_SEEDS.length; i++) {
      const seed = SMART_SEEDS[i];

      let result = await getRecentFollowings(
        apiKey,
        seed,
        pageSize
      );

      // Retry kalau kena rate limit.
      if (result.status === 429) {
        await sleep(5500);

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

      // Delay antar smart account.
      if (i < SMART_SEEDS.length - 1) {
        await sleep(5200);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | SCORE
    |--------------------------------------------------------------------------
    */

    const candidates = Array.from(graph.values())
      .map((account) => {
        const ageDays = accountAgeDays(
          account.createdAt
        );

        // Overlap smart followers = sinyal utama.
        let score =
          account.smartFollowerCount * 15;

        // Account baru dapat boost.
        if (ageDays !== null) {
          if (ageDays <= 7) {
            score += 25;
          } else if (ageDays <= 30) {
            score += 15;
          } else if (ageDays <= 90) {
            score += 7;
          }
        }

        // Account/project yang masih kecil dapat sedikit early boost.
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

        if (account.smartFollowerCount >= 5) {
          status = "SMART CLUSTER";
        }

        return {
          ...account,

          accountAgeDays:
            ageDays === null
              ? null
              : Number(ageDays.toFixed(1)),

          smartScore: Number(score.toFixed(2)),

          status,

          url: `https://x.com/${account.username}`
        };
      })

      /*
      |--------------------------------------------------------------------------
      | Kandidat harus di-follow minimal 2 seed.
      |--------------------------------------------------------------------------
      */

      .filter(
        (account) =>
          account.smartFollowerCount >= 2
      )

      .sort(
        (a, b) =>
          b.smartScore - a.smartScore
      )

      .slice(0, 30);

    return res.status(200).json({
      ok: true,
      mode: "smart-graph-v1",

      seeds: SMART_SEEDS.length,

      recentFollowingsPerSeed:
        pageSize,

      uniqueAccountsScanned:
        graph.size,

      smartCandidates:
        candidates.length,

      candidates,

      seedStats
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mode: "smart-graph-v1",
      error: String(error)
    });
  }
};