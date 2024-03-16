
import { GenerativeAI } from "../api/generative.js";
import { getFilesToObj, readJSON, saveFile, resolve, formatDate } from "../api/dat.js";
import { TfIdfAnalyze } from "../api/natural.js";
import { TaskPool } from "../utils.js";

import path from "path";

const settings = {
    MAX_PROMPT_LINES: 500,
    MAX_REVIEW_PER_PRODUCT: 8,
    prompts: ["summarize these product reviews and give me its ", ", return as json format, no markdown, no extra characters, just return json: {\"data\": {[key: reason]: detail}}\nSTART\n", "\nEND"]
};

const adapt = {
    get(m) {
        try {
            return JSON.parse(m);
        } catch (err) {
            return;
        }
    }
};

/**@param {import("../types").App} app */
export default async function main(app) {
    if (!app.config.GEMINI_API_KEY) {
        app.Logger.warn(`You don't have an api key yet, Get your API key from ${app.UI.hex(app.UI.Colors.Blue)(GenerativeAI.GET_API_KEY)}`);
        app.exit(app.App.exitCode.OK);
    }

    if (app.isImported) {
        let missing = ["file"].filter(k => Object.prototype.hasOwnProperty.call(app.config, k));
        if (missing.length > 0) {
            throw app.Logger.error(new Error(`missing required config ${missing.join(", ")}`));
        }
    }

    let file = app.config.file;
    if (!file) {
        let otherPromt = "OTHER (enter file path).";
        let files = await getFilesToObj(app.App.getFilePath(app.config.binPath));
        let quetions = [...Object.keys(files).filter(v => v.endsWith(".json")), app.UI.separator(), otherPromt, app.UI.separator()];
        let res = await app.UI.select("select a file as input", quetions);
        file = res === otherPromt ? await app.UI.input("enter file path:") : files[res];
    }

    if (!file) {
        throw app.Logger.error(new Error("file is required"));
    }

    app.config.file = file;
    app.Logger.info(`file: ${app.UI.hex(app.UI.Colors.Blue)(file)}`);
    const ai = new GenerativeAI(app, {
        apikeyPool: [...(app.config.GEMINI_API_KEY ? [app.config.GEMINI_API_KEY] : []), ...(app.config.apiKey ? [...app.config.apiKey] : [])]
    });

    try {
        let time = Date.now();
        /**@type {import("../types").Product[]} */
        let data = await readJSON(app.config.file);

        let results = await summarize({ app, ai }, data);
        app.Logger.log(`saved to ${app.UI.hex(app.UI.Colors.Blue)(await saveFile(resolve(app.config.output,
            `summarized-${formatDate(new Date())}-${path.basename(app.config.file)}.json`
        ), JSON.stringify(results)))}`);

        app.Logger.info(`Time taken: ${Date.now() - time}ms`);

        return results;
    } catch (err) {
        throw app.Logger.error(err);
    } finally {
        ai.exit();
    }
}

function getSortedSentences(sentences, max = settings.MAX_REVIEW_PER_PRODUCT) {
    let tfidf = new TfIdfAnalyze();
    tfidf.addDocuments(sentences);
    return tfidf.getParagraphSentenceScores().map((item) => item.sort((a, b) => b.score - a.score).slice(0, max).map(v => v.sentence));
}

function insertPrompt(prompts, data) {
    let res = prompts[0];
    for (let i = 0; i < data.length; i++) {
        res += (data[i] || "") + (prompts[i + 1] || "");
    }
    return res;
}

function splitArray(arr, size) {
    let res = [];
    for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size));
    }
    return res;
}

/**
 * @param {{app: import("../types").App, ai: GenerativeAI}} app
 * @param {import("../types").SummarizedProduct[]} data
 * @returns {Promise<import("../types").SummarizedProduct[]>}
 */
async function summarize({ app, ai }, data) {
    const reviews = [];
    await Promise.all(data.map(async (product) => {
        let res = await summarizeProduct({ app, ai }, product);
        if (res) {
            reviews.push(res);
        }
    }));
    return reviews;
}

/**
 * @param {{app: import("../types").App, ai: GenerativeAI}} app
 * @param {string[]} reviews
 * @param {"critical"|"benefits"} side
 * @returns {Promise<import("../types").Summary[]>}
 */
async function callSummarize({ app, ai }, reviews, side) {
    let sentences = getSortedSentences(reviews);
    let prompts = splitArray(sentences, settings.MAX_PROMPT_LINES).map((v) => insertPrompt(settings.prompts, [side, v.join("\n")]));
    let results = [];
    let taskPool = new TaskPool(app.config.maxConcurrency, app.App.staticConfig.DELAY_BETWEEN_TASK).addTasks(prompts.map((v) => async () => {
        try {
            let result = await ai.getAPIRotated().call(v);
            results.push(adapt.get(result));
        } catch (err) {
            app.Logger.error(err);
        }
    }));
    await taskPool.start();
    return results;
}

/**
 * @param {{app: import("../types").App, ai: GenerativeAI}} app
 * @param {import("../types").Product} product
 * @returns {Promise<import("../types").SummarizedProduct>}
 */
async function summarizeProduct({ app, ai }, product) {
    let critical = product.reviews?.critical?.map(v => v.content), positive = product.reviews?.positive?.map(v => v.content), maxLength = 40;
    if (!critical || !positive) {
        return null;
    }
    let head = `${product.title.substring(0, maxLength) + (product.title.length > maxLength ? "..." : "")}`;
    app.Logger.info(`Summarizing ${head}`);
    let summary = {
        critical: await callSummarize({ app, ai }, critical, "drawbacks"),
        positive: await callSummarize({ app, ai }, positive, "benefits")
    };
    app.Logger.info(`Summarized ${head}`);
    return {
        ...product,
        summary,
    };
}
