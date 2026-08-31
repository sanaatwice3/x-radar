export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  return res.status(200).json({
    ok: true,
    service: "x-radar",
    time: new Date().toISOString(),
    twitterApiConfigured: Boolean(process.env.TWITTER_API_KEY),
  });
}
