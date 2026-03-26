"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const fs = require("node:fs");
const chalk = require("chalk");
const ora = require("ora");
const { Command } = require("commander");
const reach = require("../lib/reach");
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function normalizePlatform(value, allowBoth = true) {
    const platform = reach.normalizePlatform(value);
    if (!allowBoth && platform === "both") {
        throw new Error("Platform must be x or instagram for this command.");
    }
    return platform;
}
function safeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function loadAnalyticsFile(filePath) {
    if (!filePath)
        return {};
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
        followers: safeNumber(parsed.followers ?? parsed.followerCount, 0),
        engagementRate: safeNumber(parsed.engagementRate ?? parsed.engagement_rate, 0)
    };
}
function getAnalyticsFromOptions(opts) {
    const fileAnalytics = loadAnalyticsFile(opts.analyticsFile);
    return {
        followers: safeNumber(opts.followers, fileAnalytics.followers || 0),
        engagementRate: safeNumber(opts.engagementRate, fileAnalytics.engagementRate || 0)
    };
}
function gradeColor(score) {
    if (score >= 85)
        return chalk.greenBright;
    if (score >= 70)
        return chalk.yellowBright;
    if (score >= 55)
        return chalk.hex("#f6c177");
    return chalk.redBright;
}
function priorityColor(priority) {
    if (priority === "HIGH")
        return chalk.redBright;
    if (priority === "MEDIUM")
        return chalk.yellowBright;
    return chalk.cyanBright;
}
function renderBar(score, max) {
    const width = 18;
    const ratio = max > 0 ? score / max : 0;
    const filled = Math.round(ratio * width);
    const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
    const color = ratio >= 0.75 ? chalk.green : ratio >= 0.45 ? chalk.yellow : chalk.red;
    return color(bar);
}
function platformHeader(platform) {
    if (platform === "x")
        return chalk.cyanBright.bold("𝕏 Reach Analysis");
    return chalk.magentaBright.bold("Instagram Reach Analysis");
}
function renderTimingSummary(timing) {
    const lines = [];
    lines.push(chalk.cyanBright(`Timing for ${timing.today} (${timing.nowIst})`));
    if (timing.postNow) {
        lines.push(chalk.bgGreen.black(" POST NOW "));
    }
    else {
        lines.push(chalk.yellow(`Next best window in ${timing.topWindow.hoursUntil}h: ${timing.topWindow.label} (${timing.topWindow.startLabel} - ${timing.topWindow.endLabel})`));
    }
    lines.push(chalk.gray(timing.dayNote));
    timing.windows.forEach((window, index) => {
        const badge = window.live ? chalk.bgGreen.black(" LIVE ") : chalk.gray(`in ${window.hoursUntil}h`);
        lines.push(`  ${index + 1}. ${chalk.white(window.label)} ${chalk.gray(`${window.startLabel} - ${window.endLabel}`)} ${chalk.cyan(`${window.score}/10`)} ${badge}`);
    });
    return lines;
}
function renderSuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return [chalk.green("No major fixes needed.")];
    }
    return suggestions.map((suggestion, index) => (`${index + 1}. ${priorityColor(suggestion.priority)(`[${suggestion.priority}]`)} ${suggestion.issue}\n` +
        `   Fix: ${suggestion.fix}\n` +
        `   Example: ${chalk.gray(suggestion.example)}`));
}
function renderPlaybookSteps(playbook, limit) {
    const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
    return steps.slice(0, limit).map((step, index) => (`${index + 1}. ${chalk.white(step.minuteRange)} ${step.action}\n   ${chalk.gray(step.why)}`));
}
function renderAnalysis(platform, analysis) {
    const colorize = gradeColor(analysis.score);
    const lines = [];
    lines.push("");
    lines.push(platformHeader(platform));
    lines.push(colorize(`[${analysis.score}/100] ${analysis.grade} — ${analysis.label}`));
    lines.push(chalk.gray(analysis.summary));
    if (analysis.analyticsBonus > 0) {
        lines.push(chalk.cyan(`Analytics bonus: +${analysis.analyticsBonus}`));
    }
    lines.push("");
    lines.push(chalk.bold("Breakdown"));
    analysis.breakdown.forEach((dimension) => {
        lines.push(`  ${dimension.label.padEnd(18)} ${renderBar(dimension.score, dimension.max)} ${chalk.white(`${dimension.score}/${dimension.max}`)}`);
        lines.push(`  ${chalk.gray(`  ${dimension.note}`)}`);
    });
    lines.push("");
    lines.push(chalk.bold("Suggestions"));
    renderSuggestions(analysis.suggestions).forEach((line) => lines.push(line));
    lines.push("");
    renderTimingSummary(analysis.timing).forEach((line) => lines.push(line));
    lines.push("");
    lines.push(chalk.bold("First 30 Minutes"));
    renderPlaybookSteps(analysis.playbook, 4).forEach((line) => lines.push(line));
    return lines.join("\n");
}
function renderTiming(platform, timing) {
    const lines = [];
    lines.push("");
    lines.push(platformHeader(platform).replace("Analysis", "Timing"));
    renderTimingSummary(timing).forEach((line) => lines.push(line));
    return lines.join("\n");
}
function renderPlaybook(platform, playbook) {
    const lines = [];
    lines.push("");
    lines.push(platformHeader(platform).replace("Analysis", "Playbook"));
    lines.push(chalk.gray(playbook.label));
    lines.push("");
    playbook.steps.forEach((step, index) => {
        lines.push(`${index + 1}. ${chalk.white(step.minuteRange)} ${step.action}`);
        lines.push(`   ${chalk.gray(step.why)}`);
    });
    return lines.join("\n");
}
function analyzeAction(draft, opts) {
    const platform = normalizePlatform(opts.platform, true);
    const analytics = getAnalyticsFromOptions(opts);
    const spinner = !opts.json && process.stdout.isTTY
        ? ora(`Scoring ${platform === "both" ? "X and Instagram" : platform} draft...`).start()
        : null;
    try {
        const output = reach.analyze({
            platform,
            draft,
            image: opts.image,
            followers: analytics.followers,
            engagementRate: analytics.engagementRate
        });
        if (spinner)
            spinner.succeed("Reach analysis ready.");
        if (opts.json) {
            printJson(output);
            return;
        }
        Object.entries(output).forEach(([key, analysis]) => {
            process.stdout.write(`${renderAnalysis(key, analysis)}\n`);
        });
    }
    catch (error) {
        if (spinner)
            spinner.fail("Reach analysis failed.");
        throw error;
    }
}
const command = new Command("reach")
    .description("Score draft posts for algorithmic reach before posting");
command
    .command("analyze")
    .description("Analyze a draft for reach potential")
    .requiredOption("--platform <platform>", "x | instagram | both")
    .requiredOption("--draft <draft>", "Draft post text")
    .option("--image <path>", "Optional image or video path")
    .option("--followers <count>", "Follower count", "0")
    .option("--engagement-rate <rate>", "Engagement rate, e.g. 0.04", "0")
    .option("--analytics-file <path>", "JSON file with followers / engagementRate")
    .option("--json", "Output machine-readable JSON", false)
    .action((opts) => analyzeAction(opts.draft, opts));
command
    .command("score")
    .description("Quick shorthand for analyze")
    .argument("<draft>", "Draft post text")
    .requiredOption("--platform <platform>", "x | instagram | both")
    .option("--image <path>", "Optional image or video path")
    .option("--followers <count>", "Follower count", "0")
    .option("--engagement-rate <rate>", "Engagement rate, e.g. 0.04", "0")
    .option("--analytics-file <path>", "JSON file with followers / engagementRate")
    .option("--json", "Output machine-readable JSON", false)
    .action((draft, opts) => analyzeAction(draft, opts));
command
    .command("timing")
    .description("Show the best timing windows in IST")
    .requiredOption("--platform <platform>", "x | instagram")
    .option("--json", "Output machine-readable JSON", false)
    .action((opts) => {
    const platform = normalizePlatform(opts.platform, false);
    const timing = reach.getOptimalWindows(platform);
    if (opts.json) {
        printJson(timing);
        return;
    }
    process.stdout.write(`${renderTiming(platform, timing)}\n`);
});
command
    .command("playbook")
    .description("Show the first-30-minute engagement playbook")
    .requiredOption("--platform <platform>", "x | instagram")
    .option("--score <score>", "Optional score context", "0")
    .option("--json", "Output machine-readable JSON", false)
    .action((opts) => {
    const platform = normalizePlatform(opts.platform, false);
    const score = safeNumber(opts.score, 0);
    const playbook = reach.getEngagementPlaybook(platform, score);
    if (opts.json) {
        printJson(playbook);
        return;
    }
    process.stdout.write(`${renderPlaybook(platform, playbook)}\n`);
});
module.exports = command;
module.exports._private = {
    getAnalyticsFromOptions,
    loadAnalyticsFile,
    renderAnalysis,
    renderPlaybook,
    renderTiming
};
