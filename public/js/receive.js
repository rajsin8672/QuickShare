import { formatBytes, formatDateTime, formatTimeRemaining, showToast, copyToClipboard, initMobileNav } from './common.js';

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();

  // State
  let activeShareCode = '';
  let activeAuthToken = '';
  let currentShareData = null;

  // DOM Elements
  const codeForm = document.getElementById('code-form');
  const codeInput = document.getElementById('code-input');
  const pasteCodeBtn = document.getElementById('paste-code-btn');
  const submitCodeBtn = document.getElementById('submit-code-btn');
  const receiveAlert = document.getElementById('receive-alert');

  const passwordCard = document.getElementById('password-card');
  const passwordInput = document.getElementById('share-password');
  const submitPasswordBtn = document.getElementById('submit-password-btn');
  const passwordError = document.getElementById('password-error');

  const contentCard = document.getElementById('content-card');
  const shareCodeHeader = document.getElementById('share-code-header');
  const badgeExpires = document.getElementById('badge-expires');
  const badgeFiles = document.getElementById('badge-files');
  const badgeDownloads = document.getElementById('badge-downloads');

  const textMessageCard = document.getElementById('text-message-card');
  const receivedText = document.getElementById('received-text');
  const copyTextBtn = document.getElementById('copy-text-btn');

  const filesSection = document.getElementById('files-section');
  const filesTbody = document.getElementById('files-tbody');
  const downloadAllBtn = document.getElementById('download-all-btn');

  // Preview Modal
  const previewModal = document.getElementById('preview-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalDownloadBtn = document.getElementById('modal-download-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  // 1. Code Input Formatting & Auto-Trim
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    });
  }

  // 2. Paste Code Button
  if (pasteCodeBtn && codeInput) {
    pasteCodeBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          codeInput.value = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          showToast('Code pasted!', 'info');
        }
      } catch (err) {
        showToast('Unable to access clipboard. Please paste manually.', 'info');
      }
    });
  }

  // 3. Helper to show error banner
  function showAlert(message, type = 'danger') {
    if (!receiveAlert) return;
    receiveAlert.textContent = message;
    receiveAlert.className = `alert alert-${type}`;
    receiveAlert.style.display = 'flex';
  }

  function hideAlert() {
    if (receiveAlert) receiveAlert.style.display = 'none';
  }

  // 4. Submit Share Code
  if (codeForm) {
    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (codeInput?.value || '').trim();
      if (!code) {
        showAlert('Please enter a valid sharing code.');
        return;
      }
      fetchShare(code);
    });
  }

  // Fetch share by code
  async function fetchShare(code, token = '') {
    hideAlert();
    if (submitCodeBtn) {
      submitCodeBtn.disabled = true;
      submitCodeBtn.textContent = 'Verifying...';
    }
    if (passwordCard) passwordCard.style.display = 'none';
    if (contentCard) contentCard.style.display = 'none';

    try {
      const res = await fetch('/api/shares/receive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-share-token': token } : {})
        },
        body: JSON.stringify({ code, token })
      });

      const response = await res.json();
      if (submitCodeBtn) {
        submitCodeBtn.disabled = false;
        submitCodeBtn.textContent = 'Access Files';
      }

      if (!res.ok || !response.success) {
        showAlert(response.error || 'Failed to access share.');
        return;
      }

      activeShareCode = code;
      const data = response.data;

      // Check if password required
      if (data.requiresPassword) {
        activeAuthToken = '';
        showPasswordPrompt(data);
      } else {
        if (token) activeAuthToken = token;
        showUnlockedShare(data);
      }
    } catch (err) {
      if (submitCodeBtn) {
        submitCodeBtn.disabled = false;
        submitCodeBtn.textContent = 'Access Files';
      }
      showAlert('Network error while looking up code. Please check your connection.');
    }
  }

  // 5. Password Prompt Handling
  function showPasswordPrompt(data) {
    if (passwordCard) {
      passwordCard.style.display = 'block';
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }
      if (passwordError) passwordError.style.display = 'none';
    }
    window.scrollTo({ top: passwordCard?.offsetTop - 80 || 0, behavior: 'smooth' });
  }

  if (submitPasswordBtn) {
    submitPasswordBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const password = (passwordInput?.value || '').trim();
      if (!password) {
        if (passwordError) {
          passwordError.textContent = 'Please enter the share password.';
          passwordError.style.display = 'block';
        }
        return;
      }

      submitPasswordBtn.disabled = true;
      submitPasswordBtn.textContent = 'Verifying...';
      if (passwordError) passwordError.style.display = 'none';

      try {
        const res = await fetch(`/api/shares/${encodeURIComponent(activeShareCode)}/verify-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const result = await res.json();
        submitPasswordBtn.disabled = false;
        submitPasswordBtn.textContent = 'Unlock Share';

        if (!res.ok || !result.success) {
          if (passwordError) {
            passwordError.textContent = result.error || 'Incorrect password.';
            passwordError.style.display = 'block';
          }
          return;
        }

        activeAuthToken = result.data.token;
        if (passwordCard) passwordCard.style.display = 'none';
        showUnlockedShare(result.data.share);
      } catch (err) {
        submitPasswordBtn.disabled = false;
        submitPasswordBtn.textContent = 'Unlock Share';
        if (passwordError) {
          passwordError.textContent = 'Network error verifying password.';
          passwordError.style.display = 'block';
        }
      }
    });
  }

  // 6. Render Unlocked Share Content
  function showUnlockedShare(share) {
    currentShareData = share;
    hideAlert();
    if (passwordCard) passwordCard.style.display = 'none';
    if (contentCard) contentCard.style.display = 'block';

    if (shareCodeHeader) shareCodeHeader.textContent = share.shareCode;
    if (badgeExpires) badgeExpires.textContent = `Expires: ${formatDateTime(share.expiresAt)} (${formatTimeRemaining(share.expiresAt)})`;
    if (badgeFiles) badgeFiles.textContent = `${share.fileCount} file(s) (${formatBytes(share.totalSizeBytes)})`;
    if (badgeDownloads) {
      if (share.downloadLimit) {
        badgeDownloads.textContent = `Downloads: ${share.downloadCount} of ${share.downloadLimit}`;
      } else {
        badgeDownloads.textContent = `Downloads: ${share.downloadCount} (Unlimited)`;
      }
    }

    // Render Text Message safely using textContent
    if (share.textContent) {
      if (textMessageCard) textMessageCard.style.display = 'block';
      if (receivedText) {
        // Crucial security requirement: NEVER use innerHTML for user-uploaded text!
        receivedText.textContent = share.textContent;
      }
    } else {
      if (textMessageCard) textMessageCard.style.display = 'none';
    }

    // Render Files List
    if (filesTbody) filesTbody.innerHTML = '';
    const files = share.files || [];

    if (files.length > 0) {
      if (filesSection) filesSection.style.display = 'block';
      if (downloadAllBtn) {
        downloadAllBtn.style.display = files.length > 1 ? 'inline-flex' : 'none';
      }

      files.forEach(file => {
        const tr = document.createElement('tr');

        // Filename
        const tdName = document.createElement('td');
        tdName.style.fontWeight = '500';
        tdName.textContent = file.originalFilename;

        // Type Badge
        const tdType = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'file-badge';
        if (file.mimeType.includes('pdf')) {
          badge.classList.add('badge-pdf');
          badge.textContent = 'PDF';
        } else if (file.mimeType.includes('image')) {
          badge.classList.add('badge-image');
          badge.textContent = 'IMAGE';
        } else if (file.mimeType.includes('text')) {
          badge.classList.add('badge-text');
          badge.textContent = 'TXT';
        } else {
          badge.classList.add('badge-doc');
          badge.textContent = 'DOC';
        }
        tdType.appendChild(badge);

        // File Size
        const tdSize = document.createElement('td');
        tdSize.textContent = formatBytes(file.fileSize);

        // Actions
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'table-actions';

        // Preview button (if supported format)
        if (file.canPreview) {
          const previewBtn = document.createElement('button');
          previewBtn.type = 'button';
          previewBtn.className = 'btn btn-secondary btn-sm';
          previewBtn.textContent = 'Preview';
          previewBtn.addEventListener('click', () => openPreviewModal(file));
          actionsDiv.appendChild(previewBtn);
        }

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn btn-primary btn-sm';
        downloadBtn.textContent = 'Download';
        downloadBtn.addEventListener('click', () => downloadSingleFile(file));
        actionsDiv.appendChild(downloadBtn);

        tdActions.appendChild(actionsDiv);

        tr.appendChild(tdName);
        tr.appendChild(tdType);
        tr.appendChild(tdSize);
        tr.appendChild(tdActions);

        filesTbody.appendChild(tr);
      });
    } else {
      if (filesSection) filesSection.style.display = 'none';
    }

    window.scrollTo({ top: contentCard.offsetTop - 80, behavior: 'smooth' });
  }

  // 7. Copy Text Message Button
  if (copyTextBtn && receivedText) {
    copyTextBtn.addEventListener('click', () => {
      copyToClipboard(receivedText.textContent, 'Message copied to clipboard!');
    });
  }

  // 8. Download Single File
  function downloadSingleFile(file) {
    let url = `/api/shares/${encodeURIComponent(activeShareCode)}/files/${encodeURIComponent(file.id)}/download`;
    if (activeAuthToken) {
      url += `?token=${encodeURIComponent(activeAuthToken)}`;
    }

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', file.originalFilename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Update download count on UI
    if (currentShareData && currentShareData.downloadLimit) {
      currentShareData.downloadCount += 1;
      if (badgeDownloads) {
        badgeDownloads.textContent = `Downloads: ${currentShareData.downloadCount} of ${currentShareData.downloadLimit}`;
      }
      if (currentShareData.downloadCount >= currentShareData.downloadLimit) {
        showToast('Download limit reached for this share.', 'info');
      }
    }
  }

  // 9. Download All Files as ZIP
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      let url = `/api/shares/${encodeURIComponent(activeShareCode)}/download-all`;
      if (activeAuthToken) {
        url += `?token=${encodeURIComponent(activeAuthToken)}`;
      }

      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `QuickShare_${activeShareCode}.zip`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (currentShareData && currentShareData.downloadLimit) {
        currentShareData.downloadCount += 1;
        if (badgeDownloads) {
          badgeDownloads.textContent = `Downloads: ${currentShareData.downloadCount} of ${currentShareData.downloadLimit}`;
        }
      }
    });
  }

  // 10. Preview Modal Handling
  function openPreviewModal(file) {
    if (!previewModal || !modalBody || !modalTitle) return;

    modalTitle.textContent = file.originalFilename;
    modalBody.innerHTML = '';

    let previewUrl = `/api/shares/${encodeURIComponent(activeShareCode)}/files/${encodeURIComponent(file.id)}/preview`;
    if (activeAuthToken) {
      previewUrl += `?token=${encodeURIComponent(activeAuthToken)}`;
    }

    if (file.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = file.originalFilename;
      modalBody.appendChild(img);
    } else if (file.mimeType === 'application/pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = previewUrl;
      modalBody.appendChild(iframe);
    } else if (file.mimeType === 'text/plain') {
      const pre = document.createElement('pre');
      pre.textContent = 'Loading text preview...';
      modalBody.appendChild(pre);

      fetch(previewUrl)
        .then(res => res.text())
        .then(txt => {
          pre.textContent = txt; // Safe textContent DOM injection
        })
        .catch(err => {
          pre.textContent = 'Failed to load text preview.';
        });
    }

    if (modalDownloadBtn) {
      modalDownloadBtn.onclick = () => downloadSingleFile(file);
    }

    previewModal.classList.add('active');
  }

  function closePreviewModal() {
    if (previewModal) {
      previewModal.classList.remove('active');
      if (modalBody) modalBody.innerHTML = '';
    }
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closePreviewModal);
  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) closePreviewModal();
    });
  }

  // 11. Check URL parameters on page load (e.g., receive.html?code=XYZ89)
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam) {
    const cleanCode = codeParam.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (codeInput) codeInput.value = cleanCode;
    fetchShare(cleanCode);
  }
});

