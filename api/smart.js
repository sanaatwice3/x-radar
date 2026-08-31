const API_BASE = "https://api.twitterapi.io";

const SMART_SEEDS = [
  "0xngmi",
  "DefiIgnas",
  "Route2FI",
  "Dynamo_Patrick",
  "TheDeFinvestor",
  "blocmatesdotcom",
];

const BATCH_SIZE = 3;
const REQUEST_DELAY_MS = 5200;
const RETRY_DELAY_MS = 5500;

// Redis key. Satu snapshot menyimpan kondisi Smart Graph scan sebelumnya.
const SNAPSHOT_KEY = "x-radar:smart-graph:snapshot:v1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function numberField(obj, ...fields) {
  for (const field of fields) {
    const value = obj?.[field];

    if (value !== undefined && value !== null && value !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function stringField(obj, ...fields) {
  for (const field of fields) {
    const value = obj?.[field];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function booleanField(obj, ...fields) {
  for (const field of fields) {
    if (typeof obj?.[field] === "boolean") {
      return obj[field];
    }
  }

  return false;
}

function normalizeUser(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  // Beberapa response API dapat membungkus user di property "user".
  const user =
    raw.user && typeof raw.user === "object"
      ? raw.user
      : raw;

  const username = stringField(
    user,
    "userName",
    "username",
    "screen_name",
    "screenName"
  ).replace(/^@/, "");

  if (!username) {
    return null;
  }

  return {
    username,
    name: stringField(user, "name", "displayName"),
    description: stringField(
      user,
      "description",
      "bio"
    ),

    followers: numberField(
      user,
      "followers_count",
      "followersCount",
      "followers"
    ),

    following: numberField(
      user,
      "following_count",
      "followingCount",
      "following",
      "friends_count"
    ),

    statuses: numberField(
      user,
      "tweet_count",
      "statuses_count",
      "statusesCount",
      "statuses"
    ),

    createdAt: stringField(
      user,
      "created_at",
      "createdAt"
    ),

    verified: booleanField(
      user,
      "verified",
      "isVerified"
    ),

    id: String(
      user.id ??
      user.id_str ??
      user.rest_id ??
      ""
    ),
  };
}

function accountAgeDays(createdAt) {
  if (!createdAt) {
    return null;
  }

  const timestamp = new Date(createdAt).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (Date.now() - timestamp) / 86400000
  );
}

function getFollowingsFromResponse(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.followings)) {
    return data.followings;
  }

  if (Array.isArray(data?.data?.followings)) {
    return data.data.followings;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (Array.isArray(data.users)) {
    return data.users;
  }

  return [];
}

async function requestFollowings(apiKey, username, pageSize) {
  const params = new URLSearchParams({
    userName: username,
    pageSize: String(pageSize),
  });

  const url =
    `${API_BASE}/twitter/user/followings?${params.toString()}`;

  async function makeRequest() {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      status: response.status,
      data,
    };
  }

  let result = await makeRequest();

  if (result.status === 429) {
    await sleep(RETRY_DELAY_MS);
    result = await makeRequest();
  }

  const followings = getFollowingsFromResponse(
    result.data
  );

  return {
    status: result.status,
    followings,
    error:
      result.status >= 200 &&
      result.status < 300
        ? null
        : result.data?.message ||
          result.data?.error ||
          `HTTP ${result.status}`,
  };
}

// ============================================================
// UPSTASH REDIS
// ============================================================

function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function redisCommand(command) {
  if (!redisConfigured()) {
    return null;
  }

  const baseUrl =
    process.env.UPSTASH_REDIS_REST_URL.replace(
      /\/$/,
      ""
    );

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization:
        `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}`
    );
  }

  const data = await response.json();

  return data?.result ?? null;
}

async function loadPreviousSnapshot() {
  if (!redisConfigured()) {
    return {
      available: false,
      snapshot: {},
      savedAt: null,
    };
  }

  try {
    const result = await redisCommand([
      "GET",
      SNAPSHOT_KEY,
    ]);

    if (!result) {
      return {
        available: true,
        snapshot: {},
        savedAt: null,
      };
    }

    const parsed = JSON.parse(result);

    return {
      available: true,
      snapshot:
        parsed?.accounts &&
        typeof parsed.accounts === "object"
          ? parsed.accounts
          : {},
      savedAt: parsed?.savedAt || null,
    };
  } catch (error) {
    console.error(
      "Redis load error:",
      error.message
    );

    return {
      available: false,
      snapshot: {},
      savedAt: null,
    };
  }
}

async function saveSnapshot(accounts) {
  if (!redisConfigured()) {
    return false;
  }

  const payload = {
    savedAt: new Date().toISOString(),
    accounts,
  };

  try {
    await redisCommand([
      "SET",
      SNAPSHOT_KEY,
      JSON.stringify(payload),
    ]);

    return true;
  } catch (error) {
    console.error(
      "Redis save error:",
      error.message
    );

    return false;
  }
}

// ============================================================
// SCORING
// ============================================================

function calculateSmartScore(account) {
  let score = 0;

  const age =
    account.accountAgeDays ?? 99999;

  // Smart followers merupakan sinyal utama.
  score += account.smartFollowerCount * 15;

  // Akun sangat baru.
  if (age <= 1) {
    score += 30;
  } else if (age <= 3) {
    score += 24;
  } else if (age <= 7) {
    score += 18;
  } else if (age <= 30) {
    score += 12;
  } else if (age <= 90) {
    score += 7;
  }

  // Akun kecil / early.
  if (account.followers <= 100) {
    score += 12;
  } else if (account.followers <= 500) {
    score += 10;
  } else if (account.followers <= 2000) {
    score += 7;
  } else if (account.followers <= 10000) {
    score += 3;
  }

  // Akun dengan sedikit tweet bisa berarti project/account baru.
  if (account.statuses <= 20) {
    score += 10;
  } else if (account.statuses <= 100) {
    score += 6;
  } else if (account.statuses <= 500) {
    score += 3;
  }

  return clamp(
    Math.round(score),
    0,
    100
  );
}

function classifyBaseStatus(account) {
  const age =
    account.accountAgeDays ?? 99999;

  if (
    age <= 3 &&
    account.smartFollowerCount >= 2
  ) {
    return {
      status: "ULTRA EARLY",
      ultraStatus:
        "ULTRA EARLY SMART FOLLOW",
    };
  }

  if (
    age <= 7 &&
    account.smartFollowerCount >= 2
  ) {
    return {
      status: "SMART EARLY",
      ultraStatus: "SMART EARLY",
    };
  }

  if (account.smartFollowerCount >= 2) {
    return {
      status: "SMART SIGNAL",
      ultraStatus: null,
    };
  }

  return {
    status: "WATCH",
    ultraStatus: null,
  };
}

function looksInteresting(account) {
  if (!account?.username) {
    return false;
  }

  const username =
    account.username.toLowerCase();

  // Jangan masukkan seed sendiri sebagai discovery.
  if (
    SMART_SEEDS.some(
      (seed) =>
        seed.toLowerCase() === username
    )
  ) {
    return false;
  }

  return true;
}

// ============================================================
// HISTORY / CHANGE DETECTION
// ============================================================

function getPreviousFollowers(
  previousSnapshot,
  username
) {
  const previous =
    previousSnapshot?.[
      username.toLowerCase()
    ];

  if (!previous) {
    return [];
  }

  return Array.isArray(
    previous.smartFollowers
  )
    ? previous.smartFollowers
    : [];
}

function detectChanges(
  account,
  previousSnapshot,
  hasPreviousSnapshot
) {
  const previousSmartFollowers =
    getPreviousFollowers(
      previousSnapshot,
      account.username
    );

  // PENTING:
  // Scan pertama adalah baseline.
  // Jangan menganggap semua follower pada scan pertama sebagai "baru".
  const newSmartFollowers =
    hasPreviousSnapshot
      ? account.smartFollowers.filter(
          (seed) =>
            !previousSmartFollowers.some(
              (oldSeed) =>
                oldSeed.toLowerCase() ===
                seed.toLowerCase()
            )
        )
      : [];

  const newSmartFollowerCount =
    newSmartFollowers.length;

  let changeStatus = null;

  if (newSmartFollowerCount > 0) {
    if (
      account.accountAgeDays !== null &&
      account.accountAgeDays <= 3
    ) {
      changeStatus =
        "ULTRA EARLY SMART FOLLOW";
    } else {
      changeStatus =
        "SUDDEN SMART FOLLOW";
    }
  }

  return {
    previousSmartFollowers,
    newSmartFollowers,
    newSmartFollowerCount,
    changeStatus,
  };
}

// ============================================================
// HANDLER
// ============================================================

module.exports = async function handler(
  req,
  res
) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed",
      });
    }

    const apiKey =
      process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error:
          "TWITTER_API_KEY belum dikonfigurasi.",
      });
    }

    const size = clamp(
      Number(req.query.size) || 20,
      20,
      200
    );

    const totalBatches = Math.ceil(
      SMART_SEEDS.length / BATCH_SIZE
    );

    const requestedBatch = clamp(
      Number(req.query.batch) || 1,
      1,
      totalBatches
    );

    const startIndex =
      (requestedBatch - 1) *
      BATCH_SIZE;

    const seeds = SMART_SEEDS.slice(
      startIndex,
      startIndex + BATCH_SIZE
    );

    // Ambil snapshot SEBELUM scan baru.
    const previousState =
      await loadPreviousSnapshot();

    const previousSnapshot =
      previousState.snapshot || {};

    // Snapshot dianggap benar-benar punya history
    // kalau sudah pernah disimpan sebelumnya.
    const hasPreviousSnapshot =
      Boolean(previousState.savedAt);

    const graph = new Map();
    const seedStats = [];

    for (
      let i = 0;
      i < seeds.length;
      i++
    ) {
      const seed = seeds[i];

      if (i > 0) {
        await sleep(
          REQUEST_DELAY_MS
        );
      }

      let result;

      try {
        result =
          await requestFollowings(
            apiKey,
            seed,
            size
          );
      } catch (error) {
        seedStats.push({
          seed,
          status: 0,
          found: 0,
          error: error.message,
        });

        continue;
      }

      seedStats.push({
        seed,
        status: result.status,
        found:
          result.followings.length,
        error: result.error,
      });

      if (
        result.status < 200 ||
        result.status >= 300
      ) {
        continue;
      }

      for (
        const raw of
        result.followings
      ) {
        const user =
          normalizeUser(raw);

        if (
          !user ||
          !looksInteresting(user)
        ) {
          continue;
        }

        const key =
          user.username.toLowerCase();

        if (!graph.has(key)) {
          graph.set(key, {
            ...user,
            smartFollowers: [],
          });
        }

        const account =
          graph.get(key);

        if (
          !account.smartFollowers.includes(
            seed
          )
        ) {
          account.smartFollowers.push(
            seed
          );
        }
      }
    }

    let accounts = Array.from(
      graph.values()
    ).map((account) => {
      const age =
        accountAgeDays(
          account.createdAt
        );

      const smartFollowerCount =
        account.smartFollowers.length;

      let enriched = {
        ...account,
        smartFollowerCount,
        accountAgeDays:
          age === null
            ? null
            : Number(
                age.toFixed(2)
              ),
      };

      const score =
        calculateSmartScore(
          enriched
        );

      const baseStatus =
        classifyBaseStatus(
          enriched
        );

      enriched = {
        ...enriched,
        smartScore: score,
        status:
          baseStatus.status,
        ultraStatus:
          baseStatus.ultraStatus,
        url:
          `https://x.com/${enriched.username}`,
      };

      const changes =
        detectChanges(
          enriched,
          previousSnapshot,
          hasPreviousSnapshot
        );

      // Sudden follow mendapat bonus score.
      let finalScore =
        enriched.smartScore;

      if (
        changes.newSmartFollowerCount >
        0
      ) {
        finalScore +=
          changes.newSmartFollowerCount *
          20;
      }

      if (
        changes.changeStatus ===
        "ULTRA EARLY SMART FOLLOW"
      ) {
        finalScore += 20;
      }

      finalScore = clamp(
        finalScore,
        0,
        100
      );

      let finalStatus =
        enriched.status;

      let finalUltraStatus =
        enriched.ultraStatus;

      if (
        changes.changeStatus ===
        "SUDDEN SMART FOLLOW"
      ) {
        finalStatus =
          "SUDDEN SMART FOLLOW";
      }

      if (
        changes.changeStatus ===
        "ULTRA EARLY SMART FOLLOW"
      ) {
        finalStatus =
          "ULTRA EARLY";
        finalUltraStatus =
          "ULTRA EARLY SMART FOLLOW";
      }

      return {
        ...enriched,
        smartScore: finalScore,
        status: finalStatus,
        ultraStatus:
          finalUltraStatus,

        previousSmartFollowers:
          changes.previousSmartFollowers,

        newSmartFollowers:
          changes.newSmartFollowers,

        newSmartFollowerCount:
          changes.newSmartFollowerCount,

        changeStatus:
          changes.changeStatus,
      };
    });

    accounts.sort((a, b) => {
      // Perubahan terbaru paling atas.
      if (
        b.newSmartFollowerCount !==
        a.newSmartFollowerCount
      ) {
        return (
          b.newSmartFollowerCount -
          a.newSmartFollowerCount
        );
      }

      if (
        b.smartFollowerCount !==
        a.smartFollowerCount
      ) {
        return (
          b.smartFollowerCount -
          a.smartFollowerCount
        );
      }

      return (
        b.smartScore -
        a.smartScore
      );
    });

    const ultraEarly =
      accounts.filter(
        (account) =>
          account.ultraStatus ===
          "ULTRA EARLY SMART FOLLOW"
      );

    const suddenSmartFollows =
      accounts.filter(
        (account) =>
          account.changeStatus ===
            "SUDDEN SMART FOLLOW" ||
          account.changeStatus ===
            "ULTRA EARLY SMART FOLLOW"
      );

    const candidates =
      accounts.filter(
        (account) =>
          account.smartFollowerCount >=
          2
      );

    const discoveries =
      accounts
        .filter(
          (account) =>
            account.smartFollowerCount >=
            1
        )
        .slice(0, 50);

    const alertCandidates =
      accounts.filter(
        (account) =>
          account.newSmartFollowerCount >
            0 ||
          account.smartFollowerCount >=
            2
      );

    // ========================================================
    // MERGE SNAPSHOT
    //
    // Karena endpoint menggunakan batch,
    // jangan hapus data batch lain.
    // Kita merge hasil scan ini ke snapshot lama.
    // ========================================================

    const nextSnapshot = {
      ...previousSnapshot,
    };

    for (const account of accounts) {
      nextSnapshot[
        account.username.toLowerCase()
      ] = {
        username:
          account.username,
        smartFollowers:
          account.smartFollowers,
        smartFollowerCount:
          account.smartFollowerCount,
        followers:
          account.followers,
        accountAgeDays:
          account.accountAgeDays,
        lastSeenAt:
          new Date().toISOString(),
      };
    }

    const snapshotSaved =
      await saveSnapshot(
        nextSnapshot
      );

    const nextBatch =
      requestedBatch >=
      totalBatches
        ? 1
        : requestedBatch + 1;

    return res.status(200).json({
      ok: true,

      mode:
        "smart-graph-ultra-early-memory",

      version: "2.0-final",

      batch:
        requestedBatch,

      totalBatches,

      nextBatch,

      seedsScanned: seeds,

      recentFollowingsPerSeed:
        size,

      uniqueAccountsScanned:
        accounts.length,

      // Memory info
      memory: {
        configured:
          redisConfigured(),

        previousSnapshotExists:
          hasPreviousSnapshot,

        previousSnapshotSavedAt:
          previousState.savedAt,

        snapshotSaved,
      },

      // Akun muda + smart signal
      ultraEarlyCount:
        ultraEarly.length,

      ultraEarly:
        ultraEarly.slice(0, 20),

      // Yang paling penting:
      // smart follower BARU sejak scan sebelumnya.
      suddenSmartFollowCount:
        suddenSmartFollows.length,

      suddenSmartFollows:
        suddenSmartFollows.slice(
          0,
          20
        ),

      smartCandidates:
        candidates.length,

      candidates:
        candidates.slice(0, 30),

      discoveriesCount:
        discoveries.length,

      discoveries,

      alertCandidatesCount:
        alertCandidates.length,

      alertCandidates:
        alertCandidates.slice(
          0,
          30
        ),

      seedStats,
    });
  } catch (error) {
    console.error(
      "Smart Graph fatal error:",
      error
    );

    return res.status(500).json({
      ok: false,

      mode:
        "smart-graph-ultra-early-memory",

      version: "2.0-final",

      error:
        error.message ||
        "Unknown error",
    });
  }
};