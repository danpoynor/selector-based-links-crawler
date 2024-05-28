import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// Define __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(bodyParser.json());

app.post('/start-crawl', async (req, res) => {
  const { url, depth, mainMenuSelector, mainSelector, headerSelector, footerSelector, otherContentSelector } = req.body;

  if (!mainSelector && !headerSelector && !footerSelector && !otherContentSelector && !mainMenuSelector) {
    return res.json({ success: false, message: 'Please provide at least one CSS selector.' });
  }

  try {
    const browser = await puppeteer.launch({ headless: true });

    async function delay(time) {
      return new Promise(resolve => setTimeout(resolve, time));
    }

    async function extractLinksFromSelectors(page, selectors) {
      return await page.evaluate((selectors) => {
        const extractLinks = (selector) => {
          const container = document.querySelector(selector);
          if (!container) return null;
          return Array.from(container.querySelectorAll('a')).map(link => link.href);
        };

        return {
          mainMenuLinks: selectors.mainMenu ? extractLinks(selectors.mainMenu) : [],
          mainLinks: selectors.main ? extractLinks(selectors.main) : [],
          headerLinks: selectors.header ? extractLinks(selectors.header) : [],
          footerLinks: selectors.footer ? extractLinks(selectors.footer) : [],
          otherContentLinks: selectors.otherContent ? extractLinks(selectors.otherContent) : [],
        };
      }, selectors);
    }

    async function crawl(browser, url, depth, maxDepth, selectors, origin, visited = new Set()) {
      if (depth > maxDepth || visited.has(url)) return null;

      visited.add(url);

      if (url.startsWith('tel:') || url.startsWith('mailto:')) {
        return { url, title: null, children: [], category: 'Stub Links' };
      }

      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const result = await page.evaluate(() => {
        const getText = (selector) => {
          const element = document.querySelector(selector);
          return element ? element.innerText : '';
        };

        const getMetaContent = (name) => {
          const element = document.querySelector(`meta[name="${name}"]`);
          return element ? element.content : '';
        };

        return {
          title: document.title,
          h1: getText('h1'),
          description: getMetaContent('description'),
          url: location.href,
        };
      });

      const linksFromSelectors = await extractLinksFromSelectors(page, selectors);
      await page.close();

      if (depth === 0) {
        result.mainMenuLinks = linksFromSelectors.mainMenuLinks;
        result.mainLinks = linksFromSelectors.mainLinks;
        result.headerLinks = linksFromSelectors.headerLinks;
        result.footerLinks = linksFromSelectors.footerLinks;
        result.otherContentLinks = linksFromSelectors.otherContentLinks;
      } else {
        result.mainMenuLinks = [];
        result.mainLinks = [];
        result.headerLinks = [];
        result.footerLinks = [];
        result.otherContentLinks = [];
      }

      await delay(2000); // Delay for 2 seconds

      const filterLinks = (links) => {
        return links.filter(link => {
          const url = new URL(link, origin);
          return url.origin === origin || url.protocol === 'mailto:' || url.protocol === 'tel:' || url.origin !== origin;
        });
      };

      const crawlLinks = async (links, category) => {
        const childResults = [];
        for (const link of links) {
          const url = new URL(link, origin);
          if ((url.origin === origin || url.protocol === 'mailto:' || url.protocol === 'tel:') && !visited.has(url.href)) {
            const childResult = await crawl(browser, url.href, depth + 1, maxDepth, selectors, origin, visited);
            if (childResult) {
              childResult.category = category; // Pass category information to the child
              childResults.push(childResult);
            }
          } else {
            childResults.push({ url: url.href, title: null, children: [], category });
          }
        }
        return childResults;
      };

      result.children = [
        ...(await crawlLinks(filterLinks(result.mainMenuLinks), 'Main Menu Links')),
        ...(await crawlLinks(filterLinks(result.mainLinks), 'Main Content Links')),
        ...(await crawlLinks(filterLinks(result.headerLinks), 'Header Links')),
        ...(await crawlLinks(filterLinks(result.footerLinks), 'Footer Links')),
        ...(await crawlLinks(filterLinks(result.otherContentLinks), 'Other Content Links')),
      ];

      return result;
    }

    const selectors = {
      mainMenu: mainMenuSelector || '',
      main: mainSelector || '',
      header: headerSelector || '',
      footer: footerSelector || '',
      otherContent: otherContentSelector || '',
    };

    const origin = new URL(url).origin;
    const data = await crawl(browser, url, 0, parseInt(depth), selectors, origin);
    await browser.close();

    const outputFilePath = path.join(__dirname, 'public', 'output.json');
    await fs.writeFile(outputFilePath, JSON.stringify(data, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
