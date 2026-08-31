module.exports = async function (req, res) {
  try {
    const q = req.query.topic || "crypto";
    const minutes = Number(req.query.minutes || 30);

    return res.status(200).json({
      ok: true,
      radar: true,
      topic: q,
      minutes: minutes
    });
  } catch (e) {
    return res.status(500).json({
      error: String(e)
    });
  }
};