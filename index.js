const readers = require('./url_to_markdown_readers.js');
const processor = require('./url_to_markdown_processor.js');
const filters = require('./url_to_markdown_common_filters.js');
const validURL = require('@7c/validurl');
const express = require('express');
const rateLimit = require('express-rate-limit');
const JSDOM = require('jsdom').JSDOM;
const path = require('path');
const port = process.env.PORT || 3000;
const app = express();

const rateLimiter = rateLimit({
	windowMs: 30 * 1000,
	max: 5,
	message: 'Rate limit exceeded',
	headers: true
});

app.set('trust proxy', 1);

app.use(rateLimiter);

app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

app.use(express.json({
	limit: '10mb'
}));

function send_headers(res) {
	res.header("Access-Control-Allow-Origin", '*');
	res.header("Access-Control-Allow-Methods", 'GET, POST');
 	res.header("Access-Control-Expose-Headers", 'X-Title');
 	res.header("Content-Type", 'text/markdown');
}

function read_url(url, res, options) {
		const reader = readers.reader_for_url(url);
		send_headers(res);
		reader.read_url(url, res, options);
}

function parse_urls(input) {
	if (!input) {
		return [];
	}

	let values = [];
	if (Array.isArray(input)) {
		for (const entry of input) {
			if (typeof entry === 'string') {
				values = values.concat(entry.split(/\s+/));
			}
		}
	} else if (typeof input === 'string') {
		values = input.split(/\s+/);
	}

	return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function get_options(query) {
	const title = query.title;
	const links = query.links;
	const clean = query.clean;

	let inline_title = false;
	let ignore_links = false;
	let improve_readability = true;

	if (title !== undefined) {
		inline_title = (title === 'true');
	}
	if (links !== undefined) {
		ignore_links = (links === 'false');
	}
	if (clean !== undefined) {
		improve_readability = (clean !== 'false');
	}
	return {
		inline_title: inline_title,
		ignore_links: ignore_links,
		improve_readability: improve_readability
	};
}

app.get('/', (req, res) => {
	const url = req.query.url;
	const options = get_options(req.query);
	if (url !== undefined) {
		if (validURL(url)) {
			read_url(url, res, options);
		} else {
			res.status(400).send("Please specify a valid url query parameter");
		}
		return;
	}
	res.sendFile(path.join(__dirname, 'public_html', 'index.html'));
});

app.post('/', function(req, res) {
	let html = req.body.html;
	const url = req.body.url;
	const options = get_options(req.query);
	const id = '';
	if (readers.ignore_post(url)) {
		read_url(url, res, options);
		return;
	}
	if (!html) {
		res.status(400).send("Please provide a POST parameter called html");
	} else {
		try {
			html = filters.strip_style_and_script_blocks(html);
			let document = new JSDOM(html);
			let markdown = processor.process_dom(url, document, res, id, options);
			send_headers(res);
			res.send(markdown);
		 } catch (error) {
		 	res.status(400).send("Could not parse that document");
		}
	}

});

app.post('/batch', async (req, res) => {
	const options = get_options(req.query);
	const urls = parse_urls(req.body.urls);

	if (!urls || urls.length === 0) {
		res.status(400).send('Please provide at least one URL via the urls parameter.');
		return;
	}

	for (const url of urls) {
		if (!validURL(url)) {
			res.status(400).send(`Please specify valid URLs. Invalid value: ${url}`);
			return;
		}
	}

	send_headers(res);

	try {
		const separator = '=========';
		const pieces = [];

		for (const url of urls) {
			const markdown = await readers.read_markdown(url, { ...options });
			const cleanedMarkdown = markdown.trim();
			pieces.push(`${separator} ${url}\n\n${cleanedMarkdown}`);
		}

		res.send(pieces.join('\n\n') + '\n');
	} catch (error) {
		if (error && error.status) {
			res.status(error.status).send(error.body || 'Sorry, could not fetch and convert that URL');
		} else {
			res.status(500).send('Sorry, could not fetch and convert that URL');
		}
	}
});

app.listen(port, () => {
	console.log("app listening on port: ", port)
})
