import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Media, Video Playback, and Documents Integration', () => {

  it('M1: should upload and preview MP4 video with HTTP 206 Range streaming support', async () => {
    // Construct dummy MP4 buffer with ftyp box
    const ftypHeader = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const videoPayload = Buffer.concat([ftypHeader, Buffer.alloc(1024, 0xAA)]);

    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', videoPayload, { filename: 'sample_video.mp4', contentType: 'video/mp4' });

    assert.equal(createRes.status, 201);
    const code = createRes.body.data.shareCode;

    // Verify share metadata returns video category
    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    assert.equal(receiveRes.status, 200);
    const file = receiveRes.body.data.files[0];
    assert.equal(file.fileCategory, 'video');
    assert.equal(file.canPreview, true);

    // Test standard preview stream (200 OK)
    const streamRes = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/preview`);
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers['content-type'], 'video/mp4');
    assert.equal(streamRes.headers['accept-ranges'], 'bytes');

    // Test Range request for video seeking / streaming (206 Partial Content)
    const rangeRes = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/preview`)
      .set('Range', 'bytes=0-499');

    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers['content-range'], `bytes 0-499/${videoPayload.length}`);
    assert.equal(rangeRes.headers['content-length'], '500');
  });

  it('M2: should upload WEBM and MOV videos and permit downloads', async () => {
    // EBML header for webm
    const webmHeader = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00]);
    // QuickTime MOV header
    const movHeader = Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);

    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', webmHeader, { filename: 'clip.webm', contentType: 'video/webm' })
      .attach('files', movHeader, { filename: 'movie.mov', contentType: 'video/quicktime' });

    assert.equal(createRes.status, 201);
    const code = createRes.body.data.shareCode;

    const receiveRes = await request(app).post('/api/shares/receive').send({ code });
    assert.equal(receiveRes.body.data.files.length, 2);

    const movFile = receiveRes.body.data.files.find(f => f.originalFilename === 'movie.mov');
    assert.ok(movFile);
    assert.equal(movFile.fileCategory, 'video');

    // Test download of MOV
    const dlRes = await request(app)
      .get(`/api/shares/${code}/files/${movFile.id}/download`);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers['content-type'], 'video/quicktime');
  });

  it('M3: should upload animated GIF and photos', async () => {
    const gifBuffer = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');

    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', gifBuffer, { filename: 'animation.gif', contentType: 'image/gif' });

    assert.equal(createRes.status, 201);
    const code = createRes.body.data.shareCode;

    const receiveRes = await request(app).post('/api/shares/receive').send({ code });
    const file = receiveRes.body.data.files[0];
    assert.equal(file.fileCategory, 'image');
    assert.equal(file.canPreview, true);
  });

  it('M4: should support a multi-file mixed share with text, photo, video, PDF, and DOCX', async () => {
    const photo = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const video = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const pdf = Buffer.from('%PDF-1.5 test document');
    const docx = Buffer.from('dummy docx stream');

    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Comprehensive project package')
      .attach('files', photo, { filename: 'header.jpg', contentType: 'image/jpeg' })
      .attach('files', video, { filename: 'demo.mp4', contentType: 'video/mp4' })
      .attach('files', pdf, { filename: 'manual.pdf', contentType: 'application/pdf' })
      .attach('files', docx, { filename: 'notes.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.data.fileCount, 4);

    const code = createRes.body.data.shareCode;
    const receiveRes = await request(app).post('/api/shares/receive').send({ code });

    assert.equal(receiveRes.body.data.textContent, 'Comprehensive project package');
    assert.equal(receiveRes.body.data.files.length, 4);

    const categories = receiveRes.body.data.files.map(f => f.fileCategory);
    assert.ok(categories.includes('image'));
    assert.ok(categories.includes('video'));
    assert.ok(categories.includes('pdf'));
    assert.ok(categories.includes('document'));
  });

  it('M5: should reject unsupported video formats (e.g. AVI, MKV)', async () => {
    const aviBuffer = Buffer.from('RIFF....AVI ');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', aviBuffer, { filename: 'movie.avi', contentType: 'video/x-msvideo' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('not supported'));
  });

  it('M6: should reject file when signature does not match claimed MIME type', async () => {
    // Malicious file: plain text pretending to be PNG
    const fakePng = Buffer.from('This is a plain text file pretending to be image/png');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', fakePng, { filename: 'trojan.png', contentType: 'image/png' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('signature mismatch'));
  });

});
