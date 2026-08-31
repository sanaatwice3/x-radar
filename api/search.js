const BASE_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function getTweetTime(tweet) {
  const raw =
    tweet.createdAt ||
    tweet.created_at ||
    tweet.createdTime ||
    tweet.created_time;

  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : null;
}

function normalizeTweet(tweet) {
  const author = tweet.author || tweet.user || {};

  const username =
    author.userName ||
    author.username ||
    tweet.userName ||
    tweet.username ||
    null;

  const id =
    tweet.id ||
    tweet.tweetId ||
    tweet.tweet_id ||
    null;

  return {
    id,
    text:
      tweet.text ||
      tweet.fullText ||
      tweet.full_text ||
      "",

    createdAt:
      tweet.createdAt ||
      tweet.created_at ||
      tweet.createdTime ||
      tweet.created_time ||
      null,

    author: {
      username,
      name: author.name || tweet.authorName || null,
      followers:
        author.followers ??
        author.followersCount ??
        author.followers_count ??
        null,
    },

    engagement: {
      likes:
        tweet.likeCount ??
        tweet.likes ??
        tweet.favorite_count ??
        0,

      retweets:
        tweet.retweetCount ??
        tweet.retweets ??
        tweet.retweet_count ??
        0,

      replies:
        tweet.replyCount ??
        tweet.replies ??
        tweet.reply_count ??
        0,

      quotes:
        tweet.quoteCount ??
        tweet.quotes ??
        tweet
