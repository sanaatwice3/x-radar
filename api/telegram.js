const TELEGRAM_API = "https://api.telegram.org";

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

function getBaseUrl(req) {
  const proto =
    req.headers["x-forwarded-proto"] || "https";

  const host = req.headers.host;

  return `${proto}://${host}`;
}

async function telegram(method, payload = {}) {
  const token = getBotToken();

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN belum dikonfigurasi."
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(
      data?.description ||
        `Telegram HTTP ${response.status}`
    );
  }

  return data;
}

async function sendMessage(chatId, text) {
  const MAX = 3900;

  const chunks = [];

  for (let i = 0; i < text.length; i += MAX) {
    chunks.push(text.slice(i, i + MAX));
  }

  for (const chunk of chunks) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
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

function formatAge(days) {
  if (
    days === null ||
    days === undefined ||
    !Number.isFinite(Number(days))
  ) {
    return "unknown";
  }

  const value = Number(days);

  if (value < 1) {
    return `${Math.max(
      1,
      Math.round(value * 24)
    )}h`;
  }

  return `${value.toFixed(1)}d`;
}

function formatSmart(data) {
  if (!data?.ok) {
    return `Smart Graph error\n${data?.error || "Unknown error"}`;
  }

  const creditError = Array.isArray(data.seedStats)
    ? data.seedStats.find(
        (seed) => Number(seed.status) === 402
      )
    : null;

  if (creditError) {
    return [
      "SMART GRAPH",
      "",
      "TwitterAPI.io credits habis.",
      "Scanner tidak bisa mengambil followings sekarang.",
    ].join("\n");
  }

  const high =
    data.highPriorityAlerts ||
    data.ultraEarly ||
    [];

  const smart =
    data.candidates ||
    data.alertCandidates ||
    [];

  const picks =
    high.length > 0
      ? high.slice(0, 5)
      : smart.slice(0, 5);

  const lines = [
    "SMART GRAPH",
    "",
    `Batch: ${data.batch}/${data.totalBatches}`,
    `Accounts scanned: ${data.uniqueAccountsScanned || 0}`,
    `Ultra Early: ${data.ultraEarlyCount || 0}`,
    `Smart Candidates: ${data.smartCandidates || 0}`,
  ];

  if (!picks.length) {
    lines.push("", "No strong signal right now.");
    return lines.join("\n");
  }

  lines.push("");

  picks.forEach((account, index) => {
    const followers = Array.isArray(
      account.smartFollowers
    )
      ? account.smartFollowers.join(", ")
      : "unknown";

    lines.push(
      `${index + 1}. @${account.username}`,
      `${account.status || "WATCH"} | Score ${account.smartScore ?? 0}`,
      `Age: ${formatAge(account.accountAgeDays)}`,
      `Smart followers: ${followers}`,
      `Followers: ${account.followers ?? 0}`,
      account.url || `https://x.com/${account.username}`,
      ""
    );
  });

  return lines.join("\n").trim();
}

function normalizeRadarItems(data) {
  const possible = [
    data?.narratives,
    data?.results,
    data?.signals,
    data?.candidates,
    data?.radar,
  ];

  for (const value of possible) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function radarName(item) {
  return (
    item?.name ||
    item?.narrative ||
    item?.title ||
    item?.topic ||
    item?.entity ||
    item?.keyword ||
    "Unknown narrative"
  );
}

function formatRadar(data) {
  if (!data?.ok) {
    return `Narrative Radar error\n${data?.error || "Unknown error"}`;
  }

  const items = normalizeRadarItems(data);

  const lines = [
    "NARRATIVE RADAR",
    "",
  ];

  if (!items.length) {
    lines.push(
      "No strong narrative detected right now."
    );

    return lines.join("\n");
  }

  items.slice(0, 7).forEach((item, index) => {
    const status =
      item.status ||
      item.signal ||
      item.level ||
      "WATCH";

    const score =
      item.score ??
      item.signalScore ??
      item.narrativeScore ??
      null;

    lines.push(
      `${index + 1}. ${radarName(item)}`,
      `${status}${
        score !== null
          ? ` | Score ${Math.round(score)}`
          : ""
      }`
    );

    const tweetCount =
      item.tweetCount ??
      item.tweetsCount ??
      item.count ??
      null;

    if (tweetCount !== null) {
      lines.push(`Tweets: ${tweetCount}`);
    }

    const url =
      item.url ||
      item.topTweet?.url ||
      item.tweet?.url ||
      null;

    if (url) {
      lines.push(url);
    }

    lines.push("");
  });

  return lines.join("\n").trim();
}

function helpText() {
  return [
    "X RADAR",
    "",
    "Commands:",
    "/status",
    "/smart",
    "/smart 2",
    "/radar",
    "",
    "/smart = scan Smart Graph batch 1",
    "/smart 2 = scan batch 2",
    "/radar = scan narrative X 30 menit terakhir",
  ].join("\n");
}

async function handleCommand(req, chatId, text) {
  const baseUrl = getBaseUrl(req);

  const cleanText = String(text || "")
    .trim()
    .split("@")[0];

  const parts = cleanText.split(/\s+/);

  const command =
    parts[0]?.toLowerCase() || "";

  if (
    command === "/start" ||
    command === "/help"
  ) {
    await sendMessage(chatId, helpText());
    return;
  }

  if (command === "/status") {
    const result = await fetchJson(
      `${baseUrl}/api/health`
    );

    if (result.data?.ok) {
      await sendMessage(
        chatId,
        [
          "X RADAR STATUS",
          "",
          "Service: ONLINE",
          `Twitter API configured: ${
            result.data.twitterApiConfigured
              ? "YES"
              : "NO"
          }`,
          "Telegram: ONLINE",
        ].join("\n")
      );
    } else {
      await sendMessage(
        chatId,
        "X Radar health check failed."
      );
    }

    return;
  }

  if (command === "/smart") {
    let batch = Number(parts[1]) || 1;

    if (![1, 2].includes(batch)) {
      batch = 1;
    }

    await sendMessage(
      chatId,
      `Scanning Smart Graph batch ${batch}...`
    );

    const result = await fetchJson(
      `${baseUrl}/api/smart?size=20&batch=${batch}&telegram=${Date.now()}`
    );

    await sendMessage(
      chatId,
      formatSmart(result.data)
    );

    return;
  }

  if (command === "/radar") {
    await sendMessage(
      chatId,
      "Scanning X narratives..."
    );

    const result = await fetchJson(
      `${baseUrl}/api/radar?minutes=30&limit=10&pages=1&telegram=${Date.now()}`
    );

    await sendMessage(
      chatId,
      formatRadar(result.data)
    );

    return;
  }

  await sendMessage(
    chatId,
    helpText()
  );
}

module.exports = async function handler(req, res) {
  try {
    if (!getBotToken()) {
      return res.status(500).json({
        ok: false,
        error:
          "TELEGRAM_BOT_TOKEN belum dikonfigurasi.",
      });
    }

    // -----------------------------------------
    // GET
    // Digunakan sekali untuk memasang webhook.
    // -----------------------------------------

    if (req.method === "GET") {
      const action =
        String(req.query.action || "")
          .toLowerCase();

      if (action === "setup") {
        const baseUrl = getBaseUrl(req);

        const webhookUrl =
          `${baseUrl}/api/telegram`;

        const result = await telegram(
          "setWebhook",
          {
            url: webhookUrl,
            allowed_updates: ["message"],
          }
        );

        return res.status(200).json({
          ok: true,
          message:
            "Telegram webhook installed.",
          webhookUrl,
          telegram: result.result,
        });
      }

      if (action === "info") {
        const result = await telegram(
          "getWebhookInfo"
        );

        return res.status(200).json({
          ok: true,
          webhook: result.result,
        });
      }

      return res.status(200).json({
        ok: true,
        service: "x-radar-telegram",
        message:
          "Use ?action=setup to install webhook.",
      });
    }

    // -----------------------------------------
    // POST
    // Telegram mengirim update ke sini.
    // -----------------------------------------

    if (req.method === "POST") {
      const update = req.body || {};

      const message =
        update.message ||
        update.edited_message;

      if (!message) {
        return res.status(200).json({
          ok: true,
          ignored: true,
        });
      }

      const chatId =
        message.chat?.id;

      const text =
        message.text || "";

      if (!chatId) {
        return res.status(200).json({
          ok: true,
          ignored: true,
        });
      }

      await handleCommand(
        req,
        chatId,
        text
      );

      return res.status(200).json({
        ok: true,
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  } catch (error) {
    console.error(
      "Telegram bot error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        String(error),
    });
  }
};