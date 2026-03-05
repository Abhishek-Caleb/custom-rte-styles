/*
 * AIO Runtime action to proxy-fetch the RTE styles CSS from EDS.
 * This avoids CORS issues since server-to-server calls are not subject to CORS.
 *
 * Query params:
 *   - ref: the git branch/ref (default: 'main')
 *   - org: the GitHub org (default: 'westpac-eds-program')
 *   - repo: the GitHub repo (default: 'westpac')
 *   - path: the CSS file path (default: '/styles/rte-styles.css')
 */

const fetch = require('node-fetch');

async function main(params) {
  const ref = params.ref || 'main';
  const org = params.org || 'westpac-eds-program';
  const repo = params.repo || 'westpac';
  const cssPath = params.path || '/styles/rte-styles.css';

  const url = `https://${ref}--${repo}--${org}.aem.live${cssPath}`;

  console.log('fetch-rte-styles: fetching from', url);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: { error: `Failed to fetch CSS: ${response.status} ${response.statusText}` },
      };
    }

    const cssText = await response.text();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'text/css',
      },
      body: cssText,
    };
  } catch (error) {
    console.error('fetch-rte-styles: error', error.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: { error: error.message },
    };
  }
}

exports.main = main;
