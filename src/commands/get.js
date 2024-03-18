/* eslint-disable indent */


import { Browser } from "../api/puppeteer.js";
import { TaskPool, randomInt, createProgressBar, createMultiProgressBar, sleep, isValidUrl } from "../utils.js";
import { loadFile, saveFile, joinPath, saveCSV, splitByNewLine, formatDate } from "../api/dat.js";
import { Server } from "../api/server.js";


/**
 * @typedef {import("../types").Product} Product
 * @typedef {import("../types").ElementSelector} ElementSelector
 */


const AMAZON_SEARCH_URL = "https://www.amazon.com/s";
const config = {
    blockedResourceTypes: ["image", "font", "stylesheet"],
    proxies: [],
};
const Selector = {
    title: "#productTitle",
    price: "#corePrice_feature_div span.a-price > span",
    sales: "#social-proofing-faceout-title-tk_bought > span",
    star: "#acrPopover > span > a > span",
    reviewNumber: "[data-hook=\"total-review-count\"]",
    totalRate: "[data-hook=\"rating-out-of-text\"]",
    productsReviewLink: "[data-hook=\"see-all-reviews-link-foot\"]",
    queryLinks: "div[data-cy=title-recipe] > h2 > a",
    reviews: "div[data-hook=\"review\"]",
    reviewTitle: "a[data-hook=\"review-title\"]",
    reviewStarRating: "i[data-hook=\"review-star-rating\"]",
    reviewDate: "span[data-hook=\"review-date\"]",
    reviewBody: "span[data-hook=\"review-body\"]",
    specificantionsSize: "#variation_size_name ul li",
    specificantionsStyle: "#variation_style_name ul li",
    specificantionsColor: "#variation_color_name ul li",
    specificantionsPattern: "#variation_pattern_name ul li",
    nextPageButton: "#cm_cr-pagination_bar li.a-last > a",
};
/**@type {{[key: string]: ElementSelector}}*/
const Details = {
    href: {
        evaluate: () => {
            return location.href;
        }
    },
    title: {
        querySelector: Selector.title
    },
    price: {
        querySelector: Selector.price,
        evaluate: (el) => {
            if (!el) return "";
            return el.textContent.trim() + (document.querySelectorAll("#corePrice_desktop .aok-relative")[0]?.textContent.trim() || "");
        }
    },
    sales: {
        querySelector: Selector.sales,
        evaluate: (el) => {
            if (!el) return "";
            return el.textContent.trim();
        }
    },
    specificantions: {
        querySelectors: {
            size: {
                querySelector: [Selector.specificantionsSize],
                evaluate: (els) => {
                    if (!els || (Array.isArray(els) && !els.length)) return [];
                    return Array.from(els).map((el) => el.textContent.replace(/\n/g, "")
                        .replace(" ".repeat(64), "\n").trim());
                }
            },
            style: {
                querySelector: [Selector.specificantionsStyle],
                evaluate: (els) => {
                    if (!els || (Array.isArray(els) && !els.length)) return [];
                    return Array.from(els).map((el) => {
                        let res = el.textContent.replace(/\n/g, "").trim();
                        if (el.querySelector("img")) {
                            let img = el.querySelector("img");
                            if (img.alt) res += `(${img.alt})`;
                            if (img.src) res += " " + img.src;
                        }
                        return res;
                    });
                }
            },
            pattern: {
                querySelector: [Selector.specificantionsPattern],
                evaluate: (els) => {
                    if (!els || (Array.isArray(els) && !els.length)) return [];
                    return Array.from(els).map((el) => el.textContent.replace(" ".repeat(32), "").trim());
                }
            }
        },
        evaluate: ({ size, style, pattern }) => {
            return {
                size, style, pattern
            };
        }
    },
    star: {
        querySelector: Selector.totalRate,
        evaluate: (el) => {
            return parseFloat(el.textContent.trim()) || el.textContent.trim();
        }
    },
    reviewNumber: {
        querySelector: Selector.reviewNumber,
        evaluate: (el) => {
            return parseInt(el.textContent.trim().replace(",", ""));
        }
    },
    productsReviewLink: {
        querySelector: Selector.productsReviewLink,
        evaluate: (el) => {
            return el.href;
        }
    },
};
const ReviewSelectors = {
    title: {
        querySelector: Selector.reviewTitle,
        evaluate: (el) => {
            return el.textContent.split("\n".repeat(8) + "  \n  \n    ").slice(1).join("").trim();
        }
    },
    rating: {
        querySelector: Selector.reviewStarRating,
        evaluate: (el) => {
            return parseFloat(el.textContent.trim()) || el.textContent.trim();
        }
    },
    date: {
        querySelector: Selector.reviewDate
    },
    content: {
        querySelector: Selector.reviewBody,
        evaluate: (el) => {
            return el.textContent.split("\n".repeat(8) + "  \n  \n    ").slice(1).join("").trim();
        }
    },
};

/**
 * register a selector to be used for getting details
 * @param {string} key 
 * @param {ElementSelector} selector 
 */
export function registerDetailSelector(key, selector) {
    Details[key] = selector;
}

/**
 * register a function to be used for evaluating a selector
 * evaluate function will be called after the selector is selected
 * @example
 * app.on("beforeCommandRun", (cmd, mod) => {
 *     mod.registerDetailSelector("links", {
 *         querySelector: "a",
 *         evaluate: (el) => el.href
 *     });
 * }).run(Commands.get);
 * @param {string} key 
 * @param {function(Element|Object.<string, Element|Element[]>): any} evaluate 
 */
export function registerEvaluation(key, evaluate) {
    Details[key].evaluate = evaluate;
}

/**
 * register a proxy to be used for requests
 * @example
 * app.on("beforeCommandRun", (cmd, mod) => {
 *    mod.registerProxy(["http://127.0.0.1:8081", // some proxies
 *    ]);
 * });
 * @param {string[]|string} proxy 
 * @returns {string[]}
 */
export function registerProxy(proxy) {
    if (Array.isArray(proxy)) config.proxies.push(...proxy);
    else config.proxies.push(proxy);
    return [...config.proxies];
}




/**@param {import("../cli.js").App} app */
export default async function main(app) {
    if (app.config.debug) {
        app.Logger.debug("Debug mode enabled, Image will be loaded");
    }

    let server = new Server(app);
    let browser = new Browser(app, { args: [...(app.config.proxy ? [`--proxy-server=${"http://localhost:" + server.port}`] : [])] })
        .setAllowRecycle(true).setMaxFreePages(app.config.maxConcurrency < 10 ? 10 : app.config.maxConcurrency)
        , startTime = Date.now(), result;
    browser.usePlugin(Browser.Plugins.StealthPlugin());

    app.Logger.info("Launching browser");
    app.Logger.verbose("Import state: " + app.isImported);
    try {
        const UAs = splitByNewLine(await loadFile(app.App.getFilePath(app.App.staticConfig.USER_AGENTS_PATH)));
        // const currentUa = UAs[randomInt(0, UAs.length - 1)];
        app.Logger.verbose("User agents loaded");

        if (app.config.proxy) {
            if (config.proxies.length > 0) server.addProxis(config.proxies);
            server.init(8080);
        }

        await browser.launch({ headless: !app.config.headful });
        app.Logger.log("Browser launched");

        browser.onBeforePage(async (page) => {
            await page.setUserAgent(UAs[randomInt(0, UAs.length - 1)]);
        }).onDisconnect(() => {
            if (browser.closed) return;
            throw app.Logger.error(new Error("Browser disconnected"));
        });

        result = await browser.page(async (page) => {
            return await search({ browser, page, search: app.config.query, app, });
        });
        await browser.close();

        let time = formatDate(new Date());
        if (!app.isImported) {
            /**
             * @type {{[key: string]: function(Product[]): Promise<void>}}
             */
            let options = {
                "save as .json": async function (res) {
                    let title = app.config.query;
                    if (isValidUrl(app.config.query) && new URL(app.config.query).hostname === new URL(AMAZON_SEARCH_URL).hostname) {
                        title = new URL(app.config.query).pathname.split("/").filter(Boolean)[0];
                    }
                    let path = await saveFile(joinPath(app.config.output, `${title}-result-${time}.json`), JSON.stringify(res));
                    app.Logger.log("Saved to file: " + path);
                },
                "save as .csv": async function (res) {
                    let title = app.config.query;
                    if (isValidUrl(app.config.query) && new URL(app.config.query).hostname === new URL(AMAZON_SEARCH_URL).hostname) {
                        title = new URL(app.config.query).pathname.split("/").filter(Boolean)[0];
                    }
                    let output = [];
                    res.forEach(r => {
                        let o = {};
                        Object.entries(r).forEach(([key, value]) => {
                            if (typeof value === "string") o[key] = value;
                            else o[key] = JSON.stringify(value);
                        });
                        output.push(o);
                    });
                    let path = await saveCSV(app.config.output, `${title}-result-${time}`, output);
                    app.Logger.log("Saved to file: " + path);
                },
                "log to console": (res) => app.Logger.log(JSON.stringify(res)),
                "none": () => { }
            };
            let res = await app.UI.select("Save files to: ", Object.keys(options));
            if (res) await options[res](result);
        } else {
            app.config.file = joinPath(process.cwd(), app.config.output, `result-${time}.json`);
        }

    } catch (error) {
        app.Logger.error("An error occurred");
        app.Logger.error(error);
    } finally {
        await browser.close();
        await server.close();
    }


    app.Logger.log(`Time elapsed: ${(Date.now() - startTime) / 1000}s`);

    return result;
}

async function getProductLinks({ app, browser, page, search }) {
    let url = new URL(AMAZON_SEARCH_URL);
    url.searchParams.append("k", search);
    url.searchParams.append("s", "exact-aware-popularity-rank");
    url.searchParams.append("page", "1");

    let links = [], tried = 0;
    while (links.length < app.config.maxTask) {
        url.searchParams.set("page", ++tried);

        await page.goto(url.href, { timeout: app.config.timeOut });
        await page.waitForFunction(() => document.title.includes("Amazon.com") || document.title.includes("Sorry!"), { timeout: app.config.timeOut });

        if ((await page.title()).includes("Sorry!")) throw new Error("Access denied when searching for links: " + new URL(page.url()).pathname);

        await browser.scrowDown(page);
        if (tried > app.App.staticConfig.MAX_TRY) {
            throw new Error("Tried too many times when searching for links, max try: " + app.App.staticConfig.MAX_TRY + " reached.");
        }

        links = [...links, ...new Set(await Promise.all(
            (await page.$$(Selector.queryLinks))
                .map(async (el) => {
                    return el.evaluate(node => node.href);
                })
        ))];

        app.Logger.verbose(`Found ${links.length} links`);
    }

    return links;
}

/**
 * @param {{browser: Browser, app: import("../cli.js").App, page: import("puppeteer").Page, search: string}} arg0
 * @returns {Promise<Product[]>}
 */
async function search({ app, browser, page, search }) {
    if (!app.config.debug) await browser.blockResources(page, config.blockedResourceTypes);
    if (!search && !search.length) {
        let res = await app.UI.input("Pleae type in query to search for (or a link):");
        if (!res || !res.length) throw new Error("No query provided, please provide by --query <string>");
        app.config.query = search = res;
    }
    if (app.config.lowRam && app.config.maxConcurrency > 3) {
        app.Logger.warn("Max Concurrecy is set to 3 because of low ram mode");
        app.config.maxConcurrency = 5;
    }

    let links = isValidUrl(search) ? [search] : await getProductLinks({ app, browser, page, search });

    await browser.free(page);

    let bar = createProgressBar();
    bar.start(app.config.maxTask, 0);

    let products = [], pool = new TaskPool(app.config.maxConcurrency, app.config.lowRam ? app.App.staticConfig.DELAY_BETWEEN_TASK : 0).addTasks(
        links.slice(0, Number(app.config.maxTask)).map((link) => async () => {
            return await browser.page(async (page) => {
                if (!app.config.debug) await browser.blockResources(page, config.blockedResourceTypes);
                await page.goto(link, { timeout: app.config.timeOut });
                await page.waitForSelector(Selector.title, { timeout: app.config.timeOut });
                // await page.waitForFunction(() => document.title.includes("Amazon.com"), { timeout: app.config.timeOut });

                await browser.scrowDown(page);

                let res = await getDetails({ app, browser, page, search });
                products.push(res);

                await browser.free(page);
                bar.increment(1);
            });
        }));
    await pool.start();
    bar.stop();

    app.Logger.log(`Got ${products.length} products`);

    if (app.config.lowRam) await sleep(app.App.staticConfig.DELAY_BETWEEN_TASK);

    app.Logger.info("Running reviews search...");

    bar = createMultiProgressBar({
        format: "{bar} | {title} | {value}/{total}",
    });
    let result = await searchReviews({ app, browser, page, search }, bar, products),
        reviewNumber = result.reduce((acc, cur) => acc + Object.values(cur.reviews).map(v => v.length).reduce((a, b) => a + b, 0), 0);
    app.Logger.log(`Got ${reviewNumber} reviews`);
    bar.stop();

    return result;

}

/**
 * @param {{browser: Browser, app: import("../cli.js").App, page: import("puppeteer").Page, search: string}} arg0
 * @param {import("cli-progress").SingleBar} bar
 * @returns {Promise<ProductDetails>}
 */
async function getDetails({ app, browser, page }) {
    let details = await Promise.all(Object.keys(Details).map(async (key) => {
        try {
            return {
                key,
                value: await browser.select(page, Details[key])
            };
        } catch (err) {
            app.Logger.warn("Failed to get details: " + key + " on page: " + page.url());
            app.Logger.warn(err);
            return {
                key,
                value: ""
            };
        }
    }));
    let output = {};
    details.forEach((detail) => {
        output[detail.key] = detail.value;
    });
    return output;
}

/**
 * @param {{browser: Browser, app: import("../cli.js").App, page: import("puppeteer").Page, search: string}} arg0
 * @param {import("cli-progress").MultiBar} bar
 * @param {ProductDetails[]} datas
 * @returns {Promise<Product[]>}
 */
async function searchReviews({ app, browser }, bar, datas) {
    let result = [], pool = new TaskPool(app.config.maxConcurrency, app.config.lowRam ? app.App.staticConfig.DELAY_BETWEEN_TASK : 0).addTasks(datas.map((data) => async () => {
        try {
            result.push({
                ...data,
                reviews: {
                    positive: await getReviews({ browser, app }, { bar, data, sort: "positive" }),
                    critical: await getReviews({ browser, app }, { bar, data, sort: "critical" })
                }
            });
        } catch (err) {
            console.error(err);
        }
    }));
    await pool.start();
    bar.stop();
    return result;
}

/**
 * @param {{browser: Browser, app: import("../cli.js").App, page: import("puppeteer").Page, search: string}} arg0
 * @param {{bar: import("cli-progress").MultiBar, data: ProductDetails, sort: "positive"|"critical"}} arg1
 * @returns {Promise<Review[]>}
 */
async function getReviews({ browser, app }, { bar, data, sort = "positive" }) {
    if (app.config.maxReviews > 10) {
        app.Logger.warn("Can't get more than 10 pages of reviews, setting to 10");
        app.config.maxReviews = 10;
    }
    if (app.config.maxReviews <= 0) {
        return [];
    }
    let url = new URL(data.productsReviewLink);
    url.searchParams.set("filterByStar", sort);
    let childBar = bar.create(app.config.maxReviews, 0), pageUrl = url.href, reviews = [],
        maxTitleLength = 16, endStr = "...", txt = data.title.length > maxTitleLength ? data.title.slice(0, maxTitleLength - endStr.length) + endStr : data.title;
    await browser.page(async (page) => {
        let tried = 0;
        if (!app.config.debug) await browser.blockResources(page, config.blockedResourceTypes);

        // each page may have 10 reviews, but we can't get more than 10 pages
        try {
            while (tried < app.config.maxReviews) {
                if (tried > app.App.staticConfig.MAX_TRY) {
                    throw new Error("Tried too many times when searching for reviews, max try: " + app.App.staticConfig.MAX_TRY + " reached.");
                }

                await page.goto(pageUrl, { timeout: app.config.timeOut });
                await page.waitForFunction(() => ((document.title.includes("Amazon.com") || document.title.includes("Sign-In"))), { timeout: app.config.timeOut });

                if (page.url().includes("amazon.com/ap/signin")) {
                    app.Logger.error("Access denied when getting reviews: " + new URL(page.url()).pathname);
                    break;
                }

                await browser.scrowDown(page);

                let reviewsDiv = (await page.$$(Selector.reviews));
                if (!reviewsDiv.length) {
                    break;
                }
                let reviewDatas = await Promise.all(reviewsDiv.map(async (review) => {
                    let output = {};
                    await Promise.all(Object.keys(ReviewSelectors).map(async (key) => {
                        try {
                            output[key] = await browser.select(review, ReviewSelectors[key]);
                        } catch (err) {
                            app.Logger.warn("Failed to get review details: " + key);
                            app.Logger.warn(err);
                            output[key] = "";
                        }
                    }));
                    return output;
                }));
                reviews.push(...reviewDatas);
                childBar.increment(1, {
                    title: txt,
                });
                tried++;

                let nextPageLink = await browser.try$Eval(page, { selector: Selector.nextPageButton, evaluate: (el) => el.href });
                if (!nextPageLink) break;
                pageUrl = nextPageLink;

            }
        } catch (err) {
            app.Logger.error(err);
        } finally {
            childBar.update(app.config.maxReviews, {
                title: txt,
            });
            await browser.free(page);
        }
    });
    return reviews;
}
