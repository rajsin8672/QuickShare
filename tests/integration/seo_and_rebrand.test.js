import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Technical & On-Page SEO and F Share Rebranding Verification', () => {

  it('SEO-1: /robots.txt should be served with appropriate crawler directives', async () => {
    const res = await request(app).get('/robots.txt');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/plain'));
    
    const body = res.text;
    assert.ok(body.includes('User-agent: *'));
    assert.ok(body.includes('Allow: /'));
    assert.ok(body.includes('Allow: /upload.html'));
    assert.ok(body.includes('Allow: /receive.html'));
    assert.ok(body.includes('Disallow: /api/'));
    assert.ok(body.includes('Disallow: /share.html'));
    assert.ok(body.includes('Disallow: /*?*code='));
    assert.ok(body.includes('Sitemap:'));
    assert.ok(body.includes('/sitemap.xml'));
  });

  it('SEO-2: /sitemap.xml should only contain indexable public pages with valid XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('xml'));

    const body = res.text;
    assert.ok(body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(body.includes('/upload.html</loc>'));
    assert.ok(body.includes('/receive.html</loc>'));
    assert.ok(body.includes('/about.html</loc>'));
    assert.ok(body.includes('/privacy.html</loc>'));
    assert.ok(body.includes('/terms.html</loc>'));

    // Must never index API or dynamic files
    assert.ok(!body.includes('/api/'));
    assert.ok(!body.includes('?code='));
    assert.ok(!body.includes('/share.html'));
  });

  it('SEO-3: Homepage (/) should have complete F Share metadata and valid JSON-LD schemas', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('html'));

    const html = res.text;
    // Brand & Headings
    assert.ok(html.includes('<title>F Share | Fast, Simple & Secure File Sharing</title>'));
    assert.ok(html.includes('Share Files Online in Seconds'));
    assert.ok(html.includes('Upload files, generate a share code, and let others retrieve them easily.'));

    // Open Graph & Twitter Cards
    assert.ok(html.includes('<meta property="og:site_name" content="F Share">'));
    assert.ok(html.includes('<meta property="og:title" content="F Share | Fast, Simple & Secure File Sharing">'));
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));

    // Canonical tag and robots
    assert.ok(html.includes('<meta name="robots" content="index, follow">'));
    assert.ok(html.includes('<link rel="canonical"'));

    // JSON-LD validation
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, 'JSON-LD script tag must be present on homepage');
    
    const parsed = JSON.parse(jsonLdMatch[1]);
    assert.equal(parsed['@context'], 'https://schema.org');
    assert.ok(Array.isArray(parsed['@graph']));

    const types = parsed['@graph'].map(item => item['@type']);
    assert.ok(types.includes('WebSite'), 'Must include WebSite schema');
    assert.ok(types.includes('WebApplication'), 'Must include WebApplication schema');
    assert.ok(types.includes('FAQPage'), 'Must include FAQPage schema');

    // Verify FAQ schema has real questions
    const faq = parsed['@graph'].find(item => item['@type'] === 'FAQPage');
    assert.ok(faq.mainEntity.length >= 5);
  });

  it('SEO-4: Public pages should have unique titles and F Share branding', async () => {
    const pages = [
      { path: '/upload.html', title: 'Upload & Share Files | F Share' },
      { path: '/receive.html', title: 'Receive Files | F Share' },
      { path: '/about.html', title: 'About F Share | Architecture & Security' },
      { path: '/privacy.html', title: 'Privacy Policy | F Share' },
      { path: '/terms.html', title: 'Terms of Service | F Share' }
    ];

    for (const page of pages) {
      const res = await request(app).get(page.path);
      assert.equal(res.status, 200);
      assert.ok(res.text.includes(`<title>${page.title}</title>`), `Page ${page.path} should contain title: ${page.title}`);
      assert.ok(res.text.includes('<link rel="canonical"'), `Page ${page.path} should have canonical link`);
      assert.ok(res.text.includes('F Share'), `Page ${page.path} should feature F Share branding`);
    }
  });

  it('SEO-5: Favicons, PWA manifest, and Open Graph assets should be accessible', async () => {
    const svgRes = await request(app).get('/favicon.svg');
    assert.equal(svgRes.status, 200);
    assert.ok(svgRes.headers['content-type'].includes('svg'));

    const icoRes = await request(app).get('/favicon.ico');
    assert.equal(icoRes.status, 200);

    const manifestRes = await request(app).get('/site.webmanifest');
    assert.equal(manifestRes.status, 200);
    const manifest = JSON.parse(manifestRes.text);
    assert.equal(manifest.short_name, 'F Share');

    const ogRes = await request(app).get('/og-image.png');
    assert.equal(ogRes.status, 200);
    assert.ok(ogRes.headers['content-type'].includes('png'));
  });

  it('SEO-6: Undefined web routes should serve branded 404 page with noindex', async () => {
    const res = await request(app).get('/some-non-existent-page-url');
    assert.equal(res.status, 404);
    assert.ok(res.text.includes('404 - Page Not Found | F Share'));
    assert.ok(res.text.includes('noindex, nofollow'));
    assert.ok(res.text.includes('Return to Homepage'));
  });

  it('SEO-7: API routes must send X-Robots-Tag: noindex, nofollow header', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-robots-tag']);
    assert.ok(res.headers['x-robots-tag'].includes('noindex'));
  });

});

