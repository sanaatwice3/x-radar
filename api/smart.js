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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function numberField(obj, ...fields) {
  for (const field of fields) {
    const value = obj?.[field];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
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

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return "";
}

function booleanField(obj, ...fields) {
  for (const field of fields) {
    if (
      typeof obj?.[field] === "boolean"
    ) {
      return obj[field];
    }
  }

  return false;
}

function normalizeUser(raw) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const user =
    raw.user &&
    typeof raw.user === "object"
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

    name: stringField(
      user,
      "name",
      "displayName"
    ),

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

  const timestamp =
    new Date(createdAt).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (Date.now() - timestamp) /
      86400000
  );
}

function getFollowingsFromResponse(
  data
) {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(data.followings)
  ) {
    return data.followings;
  }

  if (
    Array.isArray(
      data?.data?.followings
    )
  ) {
    return data.data.followings;
  }

  if (
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  if (
    Array.isArray(data.users)
  ) {
    return data.users;
  }

  return [];
}

async function requestFollowings(
  apiKey,
  username,
  pageSize
) {
  const params =
    new URLSearchParams({
      userName: username,
      pageSize: String(pageSize),
    });

  const url =
    `${API_BASE}/twitter/user/followings?${params.toString()}`;

  async function makeRequest() {
    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          "X-API-Key": apiKey,
          Accept:
            "application/json",
        },
      });

    let data = null;

    try {
      data =
        await response.json();
    } catch {
      data = null;
    }

    return {
      status:
        response.status,
      data,
    };
  }

  let result =
    await makeRequest();

  if (result.status === 429) {
    await sleep(
      RETRY_DELAY_MS
    );

    result =
      await makeRequest();
  }

  const followings =
    getFollowingsFromResponse(
      result.data
    );

  return {
    status:
      result.status,

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
// FILTER
// ============================================================

function looksInteresting(account) {
  if (!account?.username) {
    return false;
  }

  const username =
    account.username.toLowerCase();

  const isSeed =
    SMART_SEEDS.some(
      (seed) =>
        seed.toLowerCase() ===
        username
    );

  if (isSeed) {
    return false;
  }

  return true;
}

// ============================================================
// SCORING
// ============================================================

function calculateSmartScore(
  account
) {
  let score = 0;

  const age =
    account.accountAgeDays ??
    99999;

  // Smart followers
  score +=
    account.smartFollowerCount *
    15;

  // Account age
  if (age <= 1) {
    score += 35;
  } else if (age <= 3) {
    score += 28;
  } else if (age <= 7) {
    score += 18;
  } else if (age <= 30) {
    score += 12;
  } else if (age <= 90) {
    score += 7;
  }

  // Small follower count
  if (
    account.followers <= 100
  ) {
    score += 12;
  } else if (
    account.followers <= 500
  ) {
    score += 10;
  } else if (
    account.followers <= 2000
  ) {
    score += 7;
  } else if (
    account.followers <= 10000
  ) {
    score += 3;
  }

  // Low post count can be early
  if (
    account.statuses <= 20
  ) {
    score += 10;
  } else if (
    account.statuses <= 100
  ) {
    score += 6;
  } else if (
    account.statuses <= 500
  ) {
    score += 3;
  }

  // Small verified boost
  if (account.verified) {
    score += 2;
  }

  return clamp(
    Math.round(score),
    0,
    100
  );
}

// ============================================================
// STATUS
// ============================================================

function classifyAccount(
  account
) {
  const age =
    account.accountAgeDays ??
    99999;

  const smart =
    account.smartFollowerCount;

  // <= 1 day
  if (
    age <= 1 &&
    smart >= 3
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW SMART CLUSTER",
      priority:
        "CRITICAL",
    };
  }

  if (
    age <= 1 &&
    smart >= 2
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW SMART SIGNAL",
      priority:
        "VERY HIGH",
    };
  }

  if (
    age <= 1 &&
    smart >= 1
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW WATCH",
      priority:
        "HIGH",
    };
  }

  // <= 3 days
  if (
    age <= 3 &&
    smart >= 3
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW SMART EARLY",
      priority:
        "VERY HIGH",
    };
  }

  if (
    age <= 3 &&
    smart >= 2
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW SMART SIGNAL",
      priority:
        "HIGH",
    };
  }

  if (
    age <= 3 &&
    smart >= 1
  ) {
    return {
      status:
        "ULTRA EARLY",
      ultraStatus:
        "NEW WATCH",
      priority:
        "HIGH",
    };
  }

  // <= 7 days
  if (
    age <= 7 &&
    smart >= 2
  ) {
    return {
      status:
        "SMART EARLY",
      ultraStatus: null,
      priority:
        "MEDIUM",
    };
  }

  // Old account but overlap
  if (smart >= 3) {
    return {
      status:
        "SMART EARLY",
      ultraStatus: null,
      priority:
        "MEDIUM",
    };
  }

  if (smart >= 2) {
    return {
      status:
        "SMART SIGNAL",
      ultraStatus: null,
      priority:
        "LOW",
    };
  }

  return {
    status: "WATCH",
    ultraStatus: null,
    priority: "LOW",
  };
}

// ============================================================
// MAIN
// ============================================================

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      if (
        req.method !== "GET"
      ) {
        return res
          .status(405)
          .json({
            ok: false,
            error:
              "Method not allowed",
          });
      }

      const apiKey =
        process.env
          .TWITTER_API_KEY;

      if (!apiKey) {
        return res
          .status(500)
          .json({
            ok: false,
            error:
              "TWITTER_API_KEY belum dikonfigurasi.",
          });
      }

      const size =
        clamp(
          Number(
            req.query.size
          ) || 20,
          20,
          200
        );

      const totalBatches =
        Math.ceil(
          SMART_SEEDS.length /
            BATCH_SIZE
        );

      const requestedBatch =
        clamp(
          Number(
            req.query.batch
          ) || 1,
          1,
          totalBatches
        );

      const startIndex =
        (requestedBatch - 1) *
        BATCH_SIZE;

      const seeds =
        SMART_SEEDS.slice(
          startIndex,
          startIndex +
            BATCH_SIZE
        );

      const graph =
        new Map();

      const seedStats = [];

      // ======================================================
      // SCAN
      // ======================================================

      for (
        let i = 0;
        i < seeds.length;
        i++
      ) {
        const seed =
          seeds[i];

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
            error:
              error.message,
          });

          continue;
        }

        seedStats.push({
          seed,

          status:
            result.status,

          found:
            result.followings
              .length,

          error:
            result.error,
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
            graph.set(key, {
              ...user,

              smartFollowers:
                [],
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

      // ======================================================
      // ENRICH
      // ======================================================

      const accounts =
        Array.from(
          graph.values()
        ).map(
          (account) => {
            const age =
              accountAgeDays(
                account.createdAt
              );

            const enriched = {
              ...account,

              smartFollowerCount:
                account
                  .smartFollowers
                  .length,

              accountAgeDays:
                age === null
                  ? null
                  : Number(
                      age.toFixed(
                        2
                      )
                    ),
            };

            const smartScore =
              calculateSmartScore(
                enriched
              );

            const classification =
              classifyAccount(
                enriched
              );

            return {
              ...enriched,

              smartScore,

              status:
                classification.status,

              ultraStatus:
                classification
                  .ultraStatus,

              priority:
                classification
                  .priority,

              url:
                `https://x.com/${enriched.username}`,
            };
          }
        );

      // ======================================================
      // SORT
      // ======================================================

      accounts.sort(
        (a, b) => {
          const priorityRank = {
            CRITICAL: 4,
            "VERY HIGH": 3,
            HIGH: 2,
            MEDIUM: 1,
            LOW: 0,
          };

          const aPriority =
            priorityRank[
              a.priority
            ] ?? 0;

          const bPriority =
            priorityRank[
              b.priority
            ] ?? 0;

          if (
            bPriority !==
            aPriority
          ) {
            return (
              bPriority -
              aPriority
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

          if (
            b.smartScore !==
            a.smartScore
          ) {
            return (
              b.smartScore -
              a.smartScore
            );
          }

          const aAge =
            a.accountAgeDays ??
            99999;

          const bAge =
            b.accountAgeDays ??
            99999;

          return aAge - bAge;
        }
      );

      // ======================================================
      // ULTRA EARLY <= 1 DAY
      // ======================================================

      const ultraEarlyOneDay =
        accounts.filter(
          (account) =>
            account
              .accountAgeDays !==
              null &&
            account
              .accountAgeDays <=
              1 &&
            account
              .smartFollowerCount >=
              1
        );

      // ======================================================
      // ULTRA EARLY <= 3 DAYS
      // ======================================================

      const ultraEarly =
        accounts.filter(
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
        );

      // ======================================================
      // SMART CANDIDATES
      // ======================================================

      const candidates =
        accounts.filter(
          (account) =>
            account
              .smartFollowerCount >=
              2
        );

      // ======================================================
      // DISCOVERIES
      // ======================================================

      const discoveries =
        accounts
          .filter(
            (account) =>
              account
                .smartFollowerCount >=
                1
          )
          .slice(0, 50);

      // ======================================================
      // TELEGRAM READY ALERTS
      // ======================================================

      const alertCandidates =
        accounts.filter(
          (account) => {
            const age =
              account
                .accountAgeDays;

            if (
              age !== null &&
              age <= 3 &&
              account
                .smartFollowerCount >=
                1
            ) {
              return true;
            }

            if (
              account
                .smartFollowerCount >=
                2
            ) {
              return true;
            }

            return false;
          }
        );

      const highPriorityAlerts =
        alertCandidates.filter(
          (account) =>
            account.priority ===
              "CRITICAL" ||
            account.priority ===
              "VERY HIGH" ||
            account.priority ===
              "HIGH"
        );

      const nextBatch =
        requestedBatch >=
        totalBatches
          ? 1
          : requestedBatch + 1;

      // ======================================================
      // RESPONSE
      // ======================================================

      return res
        .status(200)
        .json({
          ok: true,

          mode:
            "smart-graph-final-no-redis",

          version:
            "3.0-final",

          batch:
            requestedBatch,

          totalBatches,

          nextBatch,

          seedsScanned:
            seeds,

          recentFollowingsPerSeed:
            size,

          uniqueAccountsScanned:
            accounts.length,

          // <= 1 hari
          ultraEarlyOneDayCount:
            ultraEarlyOneDay.length,

          ultraEarlyOneDay:
            ultraEarlyOneDay.slice(
              0,
              20
            ),

          // <= 3 hari
          ultraEarlyCount:
            ultraEarly.length,

          ultraEarly:
            ultraEarly.slice(
              0,
              30
            ),

          // 2+ smart followers
          smartCandidates:
            candidates.length,

          candidates:
            candidates.slice(
              0,
              30
            ),

          // Semua discovery
          discoveriesCount:
            discoveries.length,

          discoveries,

          // Siap dipakai Telegram
          alertCandidatesCount:
            alertCandidates.length,

          alertCandidates:
            alertCandidates.slice(
              0,
              30
            ),

          highPriorityAlertCount:
            highPriorityAlerts.length,

          highPriorityAlerts:
            highPriorityAlerts.slice(
              0,
              20
            ),

          seedStats,
        });
    } catch (error) {
      console.error(
        "Smart Graph error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          mode:
            "smart-graph-final-no-redis",

          version:
            "3.0-final",

          error:
            error?.message ||
            String(error),
        });
    }
  };