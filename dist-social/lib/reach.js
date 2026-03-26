"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const IST_OFFSET_MINUTES = 330;
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const X_WINDOWS = [
    { label: "Morning commute", start: 7 * 60 + 30, end: 9 * 60 + 30, score: 9 },
    { label: "Lunch break", start: 11 * 60 + 30, end: 13 * 60, score: 8 },
    { label: "Evening scroll", start: 16 * 60 + 30, end: 19 * 60, score: 10 },
    { label: "Night owls", start: 21 * 60 + 30, end: 23 * 60, score: 7 }
];
const INSTAGRAM_WINDOWS = [
    { label: "Morning", start: 8 * 60 + 30, end: 10 * 60 + 30, score: 9 },
    { label: "Midday", start: 12 * 60 + 30, end: 14 * 60, score: 7 },
    { label: "Golden hour", start: 17 * 60 + 30, end: 20 * 60, score: 10 }
];
const STRONG_VERBS = [
    "stop", "start", "build", "grow", "scale", "fix", "avoid", "learn", "ship", "win", "steal", "use", "cut"
];
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function capScore(value, max) {
    return clamp(Math.round(value), 0, max);
}
function normalizePlatform(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "instagram" || value === "ig")
        return "instagram";
    if (value === "both")
        return "both";
    return "x";
}
function normalizeAnalytics(input) {
    const analytics = input.analytics || {};
    const followers = Number(input.followers
        ?? analytics.followers
        ?? analytics.followerCount
        ?? 0) || 0;
    const engagementRate = Number(input.engagementRate
        ?? analytics.engagementRate
        ?? analytics.engagement_rate
        ?? 0) || 0;
    return {
        followers: Math.max(0, followers),
        engagementRate: Math.max(0, engagementRate)
    };
}
function getWords(text) {
    return String(text || "")
        .trim()
        .split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}#@']/gu, ""))
        .filter(Boolean);
}
function firstWords(text, count) {
    return getWords(text).slice(0, count);
}
function countMatches(text, patterns) {
    return patterns.reduce((hits, pattern) => hits + (pattern.test(text) ? 1 : 0), 0);
}
function countHashtags(text) {
    const matches = String(text || "").match(/(^|\s)#[a-z0-9_]+/gi);
    return matches ? matches.length : 0;
}
function detectMediaType(image, imageMeta) {
    const raw = String(imageMeta?.type
        || imageMeta?.kind
        || imageMeta?.format
        || imageMeta?.path
        || image
        || "").trim().toLowerCase();
    if (!raw)
        return "none";
    if (/\b(video|reel|mp4|mov|avi|mkv|webm)\b/.test(raw) || /\.(mp4|mov|avi|mkv|webm)$/i.test(raw)) {
        return "video";
    }
    if (/\b(image|jpg|jpeg|png|gif|webp)\b/.test(raw) || /\.(jpg|jpeg|png|gif|webp)$/i.test(raw)) {
        return "image";
    }
    return "image";
}
function analyticsBonus(followers, engagementRate) {
    let bonus = 0;
    if (followers >= 20000)
        bonus += 3;
    else if (followers >= 5000)
        bonus += 2;
    else if (followers >= 1000)
        bonus += 1;
    if (engagementRate >= 0.06)
        bonus += 2;
    else if (engagementRate >= 0.04)
        bonus += 1;
    return clamp(bonus, 0, 5);
}
function gradeForScore(score) {
    if (score >= 85)
        return { grade: "A", label: "High reach potential" };
    if (score >= 70)
        return { grade: "B", label: "Good, likely to perform" };
    if (score >= 55)
        return { grade: "C", label: "Average, needs work" };
    if (score >= 40)
        return { grade: "D", label: "Low reach expected" };
    return { grade: "F", label: "Rewrite recommended" };
}
function ratio(dimension) {
    return dimension.max > 0 ? dimension.score / dimension.max : 0;
}
function xHookScore(draft) {
    const first = firstWords(draft, 8).join(" ").toLowerCase();
    let score = 0;
    if (/^\d+/.test(first))
        score += 6;
    if (/^(why|how|what|when|should|can|will)\b/.test(first))
        score += 5;
    if (STRONG_VERBS.some((verb) => first.includes(verb)))
        score += 5;
    if (/\b(you|your)\b/.test(first))
        score += 4;
    if (/(unpopular opinion|hot take|truth is|stop doing|nobody talks about|most people)/.test(first))
        score += 10;
    if (/^(unpopular opinion|hot take)/.test(first))
        score += 4;
    return {
        key: "hook",
        label: "Hook",
        score: capScore(score, 25),
        max: 25,
        note: "First 8 words should create instant curiosity or tension."
    };
}
function xOpinionScore(draft) {
    const text = draft.toLowerCase();
    let score = 0;
    score += countMatches(text, [
        /\b(unpopular opinion|hot take|truth is)\b/,
        /\b(most people|most founders|most creators|they|retail traders|everyone|nobody|most)\b/,
        /\b(always|never|dead|broken|wrong|waste|matters more|better than)\b/,
        /\b(i think|i believe|here\'s why)\b/,
        /\bshould\b/
    ]) * 4;
    return {
        key: "opinion",
        label: "Opinion Index",
        score: capScore(score, 20),
        max: 20,
        note: "Strong opinions outperform neutral observations on X."
    };
}
function xFormatScore(draft) {
    const text = draft.toLowerCase();
    let score = 0;
    if (/\?/.test(text))
        score += 5;
    if (/\b\d+[%x]?\b/.test(text))
        score += 4;
    if (/\b\d+\s+(ways|steps|reasons|lessons|mistakes)\b/.test(text) || /(^|\n)\d+\./.test(text))
        score += 4;
    if (/\b(i learned|i used to|yesterday|last week|story)\b/.test(text))
        score += 3;
    if (/\b(unpopular opinion|hot take)\b/.test(text))
        score += 5;
    return {
        key: "format",
        label: "Format",
        score: capScore(score, 15),
        max: 15,
        note: "Questions, stats, lists, and stories create stronger read depth."
    };
}
function xReplyBaitScore(draft) {
    const text = draft.trim().toLowerCase();
    let score = 0;
    if (/\?$/.test(text))
        score += 8;
    if (/\b(reply|comment|tell me|what do you think|agree|disagree|worth it)\b/.test(text))
        score += 6;
    if (/\b(agree|disagree)\?$/.test(text))
        score += 6;
    if (/\b(vs\.?|versus|better than|wrong|overrated|underrated)\b/.test(text))
        score += 6;
    return {
        key: "reply_bait",
        label: "Reply Bait",
        score: capScore(score, 20),
        max: 20,
        note: "The easiest reach lift on X is earning fast replies."
    };
}
function xLengthScore(draft) {
    const length = draft.trim().length;
    let score = 0;
    let note = "120-220 characters is usually the sweet spot.";
    if (length >= 120 && length <= 220)
        score = 10;
    else if (length >= 80 && length < 120)
        score = 7;
    else if (length > 220 && length <= 280)
        score = 7;
    else if (length > 280) {
        score = 2;
        note = "Over 280 characters usually wants a thread structure.";
    }
    else if (length >= 40)
        score = 4;
    else
        score = 2;
    return {
        key: "length",
        label: "Length",
        score,
        max: 10,
        note
    };
}
function xMediaScore(mediaType) {
    return {
        key: "media",
        label: "Media",
        score: mediaType === "none" ? 0 : 10,
        max: 10,
        note: mediaType === "none" ? "Media is optional on X, but it still improves stop rate." : "Media detected."
    };
}
function instagramSaveScore(draft) {
    const text = draft.toLowerCase();
    let score = 0;
    if (/\b\d+\s+(ways|steps|rules|ideas|lessons|mistakes|frameworks)\b/.test(text) || /(^|\n)\d+\./.test(text))
        score += 10;
    if (/\b(framework|system|blueprint|checklist|template|playbook)\b/.test(text))
        score += 8;
    if (/\b(save this|bookmark this|come back to this)\b/.test(text))
        score += 5;
    if (/\b(do this|try this|use this|follow these steps|actionable)\b/.test(text))
        score += 4;
    return {
        key: "save",
        label: "Save-worthiness",
        score: capScore(score, 25),
        max: 25,
        note: "Instagram reach compounds when people save or revisit the post."
    };
}
function instagramHookScore(draft) {
    const first = draft.trim().slice(0, 125).toLowerCase();
    let score = 0;
    if (/^\d+/.test(first))
        score += 6;
    if (/^[\p{Extended_Pictographic}\u2600-\u27bf]/u.test(draft.trim()))
        score += 5;
    if (/^(stop|how to|the truth|nobody tells you|before you|3 ways|5 mistakes)/.test(first))
        score += 7;
    if (/\b(secret|mistake|instead of|nobody tells you|before you)\b/.test(first))
        score += 7;
    return {
        key: "hook",
        label: "Hook",
        score: capScore(score, 20),
        max: 20,
        note: "The first 125 characters decide whether someone keeps reading."
    };
}
function instagramVisualScore(mediaType) {
    let score = 5;
    let note = "Instagram without a visual rarely travels.";
    if (mediaType === "image") {
        score = 12;
        note = "Image detected. Solid, but Reels usually get broader distribution.";
    }
    if (mediaType === "video") {
        score = 20;
        note = "Video/Reel detected. This is the best default for reach.";
    }
    return {
        key: "visual",
        label: "Visual",
        score,
        max: 20,
        note
    };
}
function instagramHashtagScore(hashtagCount) {
    let score = 0;
    let note = "3-5 focused hashtags is the healthiest range.";
    if (hashtagCount === 0)
        note = "No hashtags detected.";
    else if (hashtagCount >= 3 && hashtagCount <= 5)
        score = 15;
    else if (hashtagCount >= 6 && hashtagCount <= 10)
        score = 9;
    else if (hashtagCount >= 11) {
        score = 4;
        note = "Hashtag stuffing can suppress distribution.";
    }
    else {
        score = 6;
    }
    return {
        key: "hashtags",
        label: "Hashtags",
        score,
        max: 15,
        note
    };
}
function instagramCtaScore(draft) {
    const text = draft.toLowerCase();
    let score = 0;
    if (/\b(save this|bookmark this)\b/.test(text))
        score += 5;
    if (/\b(comment|reply|tell me)\b/.test(text))
        score += 3;
    if (/\b(share|tag someone|send this)\b/.test(text))
        score += 3;
    return {
        key: "cta",
        label: "CTA",
        score: capScore(score, 10),
        max: 10,
        note: "Ask for saves, comments, or shares to shape the engagement mix."
    };
}
function instagramLengthScore(draft) {
    const length = draft.trim().length;
    let score = 3;
    let note = "125-1200 characters is usually the healthiest range.";
    if (length < 125) {
        score = 3;
        note = "Short captions can underperform unless the visual does most of the work.";
    }
    else if (length <= 300)
        score = 8;
    else if (length <= 1200)
        score = 10;
    else
        score = 6;
    return {
        key: "length",
        label: "Length",
        score,
        max: 10,
        note
    };
}
function buildSuggestions(platform, breakdown, mediaType, hashtags) {
    const suggestions = [];
    breakdown.forEach((dimension) => {
        const health = ratio(dimension);
        if (health >= 0.8)
            return;
        if (platform === "x" && dimension.key === "hook") {
            suggestions.push({
                priority: health < 0.35 ? "HIGH" : "MEDIUM",
                issue: "The opening line is too soft for X.",
                fix: "Lead with a number, a strong verb, or a direct opinion in the first 8 words.",
                example: "Unpopular opinion: most founders should talk to users before they touch branding."
            });
        }
        if (platform === "x" && dimension.key === "reply_bait") {
            suggestions.push({
                priority: health < 0.35 ? "HIGH" : "MEDIUM",
                issue: "The post is not inviting replies.",
                fix: "End with a debatable question or a direct request for a take.",
                example: "Agree or disagree? What would you change first?"
            });
        }
        if (platform === "x" && dimension.key === "length") {
            suggestions.push({
                priority: "LOW",
                issue: "The draft length is off the X sweet spot.",
                fix: "Aim for 120-220 characters, or split longer ideas into a thread.",
                example: "Hook in the first line, support in line two, question at the end."
            });
        }
        if (platform === "instagram" && dimension.key === "save") {
            suggestions.push({
                priority: health < 0.35 ? "HIGH" : "MEDIUM",
                issue: "The caption is not obviously save-worthy.",
                fix: "Turn it into steps, a framework, or a checklist people want to revisit.",
                example: "3 steps to write captions people actually save."
            });
        }
        if (platform === "instagram" && dimension.key === "visual") {
            suggestions.push({
                priority: mediaType === "none" ? "HIGH" : "MEDIUM",
                issue: "The visual format is limiting Instagram reach.",
                fix: mediaType === "none" ? "Add an image or Reel." : "If possible, convert this into a Reel or motion-first asset.",
                example: "Use a 10-20 second Reel with the same hook in on-screen text."
            });
        }
        if (platform === "instagram" && dimension.key === "hashtags") {
            suggestions.push({
                priority: hashtags === 0 || hashtags > 10 ? "MEDIUM" : "LOW",
                issue: hashtags === 0 ? "No hashtags are helping topic discovery." : "Too many hashtags can look spammy.",
                fix: "Use 3-5 focused hashtags tied to the post topic and audience.",
                example: "#creatorgrowth #contentstrategy #instagramtips"
            });
        }
        if (platform === "instagram" && dimension.key === "cta") {
            suggestions.push({
                priority: "MEDIUM",
                issue: "The caption does not ask for the right action.",
                fix: "Add a save, comment, or share CTA that matches the post type.",
                example: "Save this for later and send it to a creator who needs it."
            });
        }
    });
    if (!suggestions.length) {
        suggestions.push({
            priority: "LOW",
            issue: "The draft is already in a healthy range.",
            fix: "Only polish clarity and formatting before you publish.",
            example: "Trim filler words and sharpen the first line."
        });
    }
    return suggestions.slice(0, 6);
}
function toIstParts(now = new Date()) {
    const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
    const hours = shifted.getUTCHours();
    const minutes = shifted.getUTCMinutes();
    const dayIndex = shifted.getUTCDay();
    const label = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} IST`;
    return {
        shifted,
        minutes: hours * 60 + minutes,
        dayIndex,
        label
    };
}
function formatMinuteLabel(totalMinutes) {
    const hours24 = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const suffix = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
function hoursUntilWindow(currentMinutes, startMinutes, live) {
    if (live)
        return 0;
    const delta = startMinutes >= currentMinutes
        ? startMinutes - currentMinutes
        : (24 * 60 - currentMinutes) + startMinutes;
    return Number((delta / 60).toFixed(1));
}
function getOptimalWindows(platform, now = new Date()) {
    const config = platform === "x"
        ? { windows: X_WINDOWS, bestDays: ["Monday", "Tuesday", "Wednesday", "Thursday"], avoidDays: ["Saturday"] }
        : { windows: INSTAGRAM_WINDOWS, bestDays: ["Tuesday", "Wednesday", "Friday"], avoidDays: ["Sunday"] };
    const nowParts = toIstParts(now);
    const dayLabel = WEEKDAY_LABELS[nowParts.dayIndex];
    const windows = config.windows
        .map((window) => {
        const live = nowParts.minutes >= window.start && nowParts.minutes <= window.end;
        const hoursUntil = hoursUntilWindow(nowParts.minutes, window.start, live);
        return {
            label: window.label,
            score: window.score,
            startLabel: formatMinuteLabel(window.start),
            endLabel: formatMinuteLabel(window.end),
            live,
            postNow: live,
            hoursUntil
        };
    })
        .sort((a, b) => {
        if (a.live && !b.live)
            return -1;
        if (!a.live && b.live)
            return 1;
        if (b.score !== a.score)
            return b.score - a.score;
        return a.hoursUntil - b.hoursUntil;
    });
    const topWindow = windows[0];
    const isBestDay = config.bestDays.includes(dayLabel);
    const isAvoidDay = config.avoidDays.includes(dayLabel);
    const dayNote = isAvoidDay
        ? `Today is ${dayLabel}. This is usually a weak day for ${platform === "x" ? "X" : "Instagram"} unless the post is unusually timely.`
        : isBestDay
            ? `${dayLabel} is one of the stronger days for ${platform === "x" ? "X" : "Instagram"} reach.`
            : `${dayLabel} is workable, but not one of the peak days.`;
    return {
        platform,
        timezone: "IST",
        nowIst: nowParts.label,
        today: dayLabel,
        postNow: windows.some((window) => window.live),
        windows,
        topWindow,
        bestDays: config.bestDays,
        avoidDays: config.avoidDays,
        isBestDay,
        isAvoidDay,
        dayNote
    };
}
function getEngagementPlaybook(platform, score) {
    const steps = [
        {
            minuteRange: "0-2 min",
            action: "Reply to your own post first.",
            why: "It seeds the reply tree and gives late viewers an angle to enter."
        },
        {
            minuteRange: "0-5 min",
            action: "Engage on 3-5 posts in your niche.",
            why: "That often triggers reciprocal profile visits while your post is still fresh."
        },
        {
            minuteRange: "5-10 min",
            action: "Reply to every comment immediately.",
            why: "Fast comment velocity is one of the strongest early distribution signals."
        },
        {
            minuteRange: "10-20 min",
            action: "DM 2-3 people who would genuinely find it useful.",
            why: "Private distribution can rescue a strong post before the first decay cycle."
        },
        {
            minuteRange: "20-30 min",
            action: "If it is flat, add a reply with a new angle.",
            why: "A second angle can restart the conversation without editing the original post."
        }
    ];
    if (platform === "x") {
        steps.push({
            minuteRange: "5-12 min",
            action: "Quote-tweet your own post with an opposite one-liner.",
            why: "That creates a built-in counterpoint and a fresh entry surface."
        }, {
            minuteRange: "8-18 min",
            action: "Reply in 2-3 active threads with your core point and no link.",
            why: "Thread replies can funnel warm traffic back into the main post."
        }, {
            minuteRange: "20-30 min",
            action: "Pin the post if replies are already landing.",
            why: "Pinning converts profile visits into more impressions while the topic is alive."
        }, {
            minuteRange: "30 min",
            action: "Check impressions-to-likes ratio.",
            why: "Above 200:1 usually means the hook is weak; below 50:1 often means it deserves a thread or follow-up."
        });
    }
    else {
        steps.push({
            minuteRange: "0-3 min",
            action: "Post it to Stories with a poll or question sticker immediately.",
            why: "Story interactions can push extra traffic back into the feed post."
        }, {
            minuteRange: "3-8 min",
            action: "Reply to your own caption comment with the key takeaway.",
            why: "That surfaces the main value prop without forcing it all into the caption."
        }, {
            minuteRange: "8-15 min",
            action: "Share it to Close Friends if that group usually engages fast.",
            why: "Early close-friends engagement is disproportionately valuable."
        }, {
            minuteRange: "30 min",
            action: "Check saves versus likes.",
            why: "If saves are under 5% of likes, push a Story CTA to remind people to bookmark the post."
        });
    }
    return {
        platform,
        score,
        label: typeof score === "number" && score < 55 ? "Low score: push distribution only after rewriting." : "First 30-minute engagement playbook",
        steps
    };
}
function analyzeX(input, followers, engagementRate) {
    const draft = String(input.draft || "").trim();
    const mediaType = detectMediaType(input.image, input.imageMeta);
    const hashtags = countHashtags(draft);
    const breakdown = [
        xHookScore(draft),
        xOpinionScore(draft),
        xFormatScore(draft),
        xReplyBaitScore(draft),
        xLengthScore(draft),
        xMediaScore(mediaType)
    ];
    const rawScore = breakdown.reduce((sum, item) => sum + item.score, 0);
    const bonus = analyticsBonus(followers, engagementRate);
    const score = clamp(rawScore + bonus, 0, 100);
    const summary = score >= 70
        ? "Strong X draft with decent viral mechanics."
        : score >= 55
            ? "Usable X draft, but the hook or reply bait needs sharpening."
            : "This X draft is unlikely to travel without a rewrite.";
    const timing = getOptimalWindows("x", input.now);
    const playbook = getEngagementPlaybook("x", score);
    const grading = gradeForScore(score);
    return {
        platform: "x",
        score,
        rawScore,
        grade: grading.grade,
        label: grading.label,
        breakdown,
        analyticsBonus: bonus,
        timing,
        playbook,
        suggestions: buildSuggestions("x", breakdown, mediaType, hashtags),
        summary,
        draftLength: draft.length,
        mediaType,
        hashtags
    };
}
function analyzeInstagram(input, followers, engagementRate) {
    const draft = String(input.draft || "").trim();
    const mediaType = detectMediaType(input.image, input.imageMeta);
    const hashtags = countHashtags(draft);
    const breakdown = [
        instagramSaveScore(draft),
        instagramHookScore(draft),
        instagramVisualScore(mediaType),
        instagramHashtagScore(hashtags),
        instagramCtaScore(draft),
        instagramLengthScore(draft)
    ];
    const rawScore = breakdown.reduce((sum, item) => sum + item.score, 0);
    const bonus = analyticsBonus(followers, engagementRate);
    const score = clamp(rawScore + bonus, 0, 100);
    const summary = score >= 70
        ? "Good Instagram draft with solid save and visual potential."
        : score >= 55
            ? "Decent Instagram draft, but it needs a clearer save or share reason."
            : "This Instagram draft needs stronger structure before posting.";
    const timing = getOptimalWindows("instagram", input.now);
    const playbook = getEngagementPlaybook("instagram", score);
    const grading = gradeForScore(score);
    return {
        platform: "instagram",
        score,
        rawScore,
        grade: grading.grade,
        label: grading.label,
        breakdown,
        analyticsBonus: bonus,
        timing,
        playbook,
        suggestions: buildSuggestions("instagram", breakdown, mediaType, hashtags),
        summary,
        draftLength: draft.length,
        mediaType,
        hashtags
    };
}
function analyze(input) {
    const normalizedPlatform = normalizePlatform(input.platform);
    const draft = String(input.draft || "").trim();
    const analytics = normalizeAnalytics(input);
    const out = {};
    if (normalizedPlatform === "x" || normalizedPlatform === "both") {
        out.x = analyzeX({ ...input, draft }, analytics.followers, analytics.engagementRate);
    }
    if (normalizedPlatform === "instagram" || normalizedPlatform === "both") {
        out.instagram = analyzeInstagram({ ...input, draft }, analytics.followers, analytics.engagementRate);
    }
    return out;
}
module.exports = {
    analyze,
    analyticsBonus,
    getEngagementPlaybook,
    getOptimalWindows,
    gradeForScore,
    normalizePlatform,
    _private: {
        analyticsBonus,
        analyzeInstagram,
        analyzeX,
        countHashtags,
        detectMediaType,
        normalizeAnalytics,
        normalizePlatform
    }
};
