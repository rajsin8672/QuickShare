import { formatBytes, formatDateTime, showToast, copyToClipboard, initMobileNav, initPasswordToggle } from './common.js';

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();

  // State
  let activeShareMode = 'files'; // 'files' | 'text' | 'both'
  let selectedFiles = []; // Array of { file, previewUrl, category, meta }
  const MAX_FILE_COUNT = 10;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100 MB
  const ALLOWED_EXTENSIONS = [
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
    '.mp4', '.webm', '.mov', '.txt', '.doc', '.docx'
  ];

  // DOM Elements
  const shareTypeTabs = document.querySelectorAll('.share-type-tab');
  const filesSectionPanel = document.getElementById('files-section-panel');
  const textSectionPanel = document.getElementById('text-section-panel');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const selectedFilesList = document.getElementById('selected-files-list');
  const totalSizeInfo = document.getElementById('total-size-info');
  const textContent = document.getElementById('text-content');
  const charCounter = document.getElementById('char-counter');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedAccordion = document.getElementById('advanced-accordion');
  const passwordInput = document.getElementById('password-input');
  const toggleUploadPasswordBtn = document.getElementById('toggle-upload-password-btn');
  const downloadLimitInput = document.getElementById('download-limit-input');
  const uploadBtn = document.getElementById('upload-btn');
  const cancelUploadBtn = document.getElementById('cancel-upload-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const uploadCard = document.getElementById('upload-card');
  const successCard = document.getElementById('success-card');

  // Success Elements
  const shareCodeText = document.getElementById('share-code-text');
  const copyCodeBtn = document.getElementById('copy-code-btn');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const qrCodeImg = document.getElementById('qr-code-img');
  const statExpires = document.getElementById('stat-expires');
  const statFiles = document.getElementById('stat-files');
  const statSize = document.getElementById('stat-size');
  const statLimit = document.getElementById('stat-limit');
  const deleteShareBtn = document.getElementById('delete-share-btn');
  const newShareBtn = document.getElementById('new-share-btn');

  // Active Share Deletion State & Active Upload XHR
  let currentShareCode = null;
  let currentDeletionToken = null;
  let activeXhr = null;

  // Initialize Password View / Hide Toggle
  initPasswordToggle(passwordInput, toggleUploadPasswordBtn);

  // Setup Share Content Mode Tabs (Separate Files and Text Sections)
  function updateUploadButtonText() {
    if (!uploadBtn) return;
    if (activeShareMode === 'files') {
      uploadBtn.innerHTML = `
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
        </svg>
        Upload Files &amp; Generate Code
      `;
    } else if (activeShareMode === 'text') {
      uploadBtn.innerHTML = `
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
        </svg>
        Share Text &amp; Generate Code
      `;
    } else {
      uploadBtn.innerHTML = `
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
        </svg>
        Share Content &amp; Generate Code
      `;
    }
  }

  shareTypeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      if (!mode) return;

      activeShareMode = mode;
      shareTypeTabs.forEach(t => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      if (mode === 'files') {
        if (filesSectionPanel) filesSectionPanel.style.display = 'block';
        if (textSectionPanel) textSectionPanel.style.display = 'none';
      } else if (mode === 'text') {
        if (filesSectionPanel) filesSectionPanel.style.display = 'none';
        if (textSectionPanel) textSectionPanel.style.display = 'block';
        if (textContent) textContent.focus();
      } else {
        // Both files and text sections visible
        if (filesSectionPanel) filesSectionPanel.style.display = 'block';
        if (textSectionPanel) textSectionPanel.style.display = 'block';
      }

      updateUploadButtonText();
    });
  });

  // 1. Text input character counter
  if (textContent && charCounter) {
    textContent.addEventListener('input', () => {
      const length = textContent.value.length;
      charCounter.textContent = `${length.toLocaleString()} / 100,000 characters`;
    });
  }

  // 2. Advanced settings toggle
  if (advancedToggle && advancedAccordion) {
    advancedToggle.addEventListener('click', () => {
      advancedAccordion.classList.toggle('active');
    });
  }

  // 3. Dropzone & File Selection Handlers
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => {
      fileInput.click();
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleFilesAdded(Array.from(dt.files));
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFilesAdded(Array.from(fileInput.files));
        fileInput.value = ''; // Reset input to allow re-selecting same file
      }
    });
  }

  // Determine file category
  function detectCategory(filename, mimeType) {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    const lowerMime = (mimeType || '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) || lowerMime.startsWith('image/')) {
      return 'image';
    }
    if (['.mp4', '.webm', '.mov'].includes(ext) || lowerMime.startsWith('video/')) {
      return 'video';
    }
    if (ext === '.pdf' || lowerMime === 'application/pdf') {
      return 'pdf';
    }
    if (ext === '.txt' || lowerMime === 'text/plain') {
      return 'text';
    }
    return 'document';
  }

  // Format seconds to mm:ss
  function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Handle addition of new files
  function handleFilesAdded(newFiles) {
    for (const file of newFiles) {
      if (selectedFiles.length >= MAX_FILE_COUNT) {
        showToast(`Maximum ${MAX_FILE_COUNT} files allowed.`, 'error');
        break;
      }

      // Check file extension
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        showToast(`"${file.name}" has an unsupported format. Supported: Photos, Videos (MP4, WEBM, MOV), PDFs, and Documents (DOC, DOCX, TXT).`, 'error');
        continue;
      }

      // Check single file size
      if (file.size > MAX_FILE_SIZE) {
        showToast(`"${file.name}" exceeds 50MB limit.`, 'error');
        continue;
      }

      // Check duplicate
      const isDuplicate = selectedFiles.some(item => item.file.name === file.name && item.file.size === file.size);
      if (!isDuplicate) {
        const category = detectCategory(file.name, file.type);
        let previewUrl = null;

        // Generate temporary object URL for images
        if (category === 'image') {
          try {
            previewUrl = URL.createObjectURL(file);
          } catch (e) {
            console.warn('Failed to create object URL for image:', e);
          }
        }

        const fileEntry = {
          file,
          previewUrl,
          category,
          metaText: ''
        };

        // For videos, attempt to safely read duration and dimensions
        if (category === 'video') {
          try {
            const tempVideoUrl = URL.createObjectURL(file);
            const tempVideo = document.createElement('video');
            tempVideo.preload = 'metadata';
            tempVideo.src = tempVideoUrl;
            tempVideo.onloadedmetadata = () => {
              const dur = formatDuration(tempVideo.duration);
              const dim = tempVideo.videoWidth && tempVideo.videoHeight ? `${tempVideo.videoWidth}x${tempVideo.videoHeight}` : '';
              fileEntry.metaText = [dim, dur].filter(Boolean).join(' • ');
              URL.revokeObjectURL(tempVideoUrl);
              renderSelectedFiles();
            };
            tempVideo.onerror = () => {
              URL.revokeObjectURL(tempVideoUrl);
            };
          } catch (e) {
            console.warn('Video metadata extraction failed:', e);
          }
        }

        selectedFiles.push(fileEntry);
      }
    }
    renderSelectedFiles();
  }

  // Render selected files list
  function renderSelectedFiles() {
    if (!selectedFilesList) return;
    selectedFilesList.innerHTML = '';

    if (selectedFiles.length === 0) {
      if (totalSizeInfo) totalSizeInfo.textContent = '';
      return;
    }

    let totalBytes = 0;
    selectedFiles.forEach((item, index) => {
      const file = item.file;
      totalBytes += file.size;

      const row = document.createElement('div');
      row.className = 'file-item';

      const info = document.createElement('div');
      info.className = 'file-item-info';

      // Visual Thumbnail or Category Icon
      if (item.category === 'image' && item.previewUrl) {
        const img = document.createElement('img');
        img.className = 'file-thumbnail';
        img.src = item.previewUrl;
        img.alt = file.name;
        info.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'file-icon-placeholder';

        let iconSvg = '';
        if (item.category === 'video') {
          iconSvg = `
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          `;
        } else if (item.category === 'pdf') {
          iconSvg = `
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
            </svg>
          `;
        } else {
          iconSvg = `
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          `;
        }
        placeholder.innerHTML = iconSvg;
        info.appendChild(placeholder);
      }

      // Metadata details
      const metaDiv = document.createElement('div');
      metaDiv.className = 'file-item-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name';
      nameSpan.textContent = file.name;
      nameSpan.title = file.name;

      const subDiv = document.createElement('div');
      subDiv.className = 'file-item-sub';

      // Badge
      const badge = document.createElement('span');
      badge.className = `file-badge badge-${item.category === 'video' ? 'video' : item.category === 'image' ? 'image' : item.category === 'pdf' ? 'pdf' : item.category === 'text' ? 'text' : 'doc'}`;
      badge.textContent = item.category.toUpperCase();

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'file-size';
      sizeSpan.textContent = formatBytes(file.size);

      subDiv.appendChild(badge);
      subDiv.appendChild(sizeSpan);

      if (item.metaText) {
        const extraSpan = document.createElement('span');
        extraSpan.style.color = 'var(--text-muted)';
        extraSpan.textContent = item.metaText;
        subDiv.appendChild(extraSpan);
      }

      metaDiv.appendChild(nameSpan);
      metaDiv.appendChild(subDiv);
      info.appendChild(metaDiv);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'file-remove-btn';
      removeBtn.title = 'Remove file';
      removeBtn.innerHTML = `
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      `;

      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Revoke temporary object URL if present
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
        selectedFiles.splice(index, 1);
        renderSelectedFiles();
      });

      row.appendChild(info);
      row.appendChild(removeBtn);
      selectedFilesList.appendChild(row);
    });

    if (totalSizeInfo) {
      totalSizeInfo.textContent = `Total: ${selectedFiles.length} file(s), ${formatBytes(totalBytes)} (Max 100MB)`;
      if (totalBytes > MAX_TOTAL_SIZE) {
        totalSizeInfo.style.color = 'var(--danger)';
      } else {
        totalSizeInfo.style.color = 'var(--text-muted)';
      }
    }
  }

  // 4. Cancel active upload
  if (cancelUploadBtn) {
    cancelUploadBtn.addEventListener('click', () => {
      if (activeXhr) {
        activeXhr.abort();
        activeXhr = null;
        uploadBtn.disabled = false;
        updateUploadButtonText();
        if (progressContainer) progressContainer.style.display = 'none';
        showToast('Upload canceled.', 'info');
      }
    });
  }

  // 5. Submit Upload
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      const text = (textContent?.value || '').trim();

      // Validate according to the active section mode
      if (activeShareMode === 'files') {
        if (selectedFiles.length === 0) {
          showToast('Please select at least one file to upload.', 'error');
          return;
        }
      } else if (activeShareMode === 'text') {
        if (!text) {
          showToast('Please enter a text message to share.', 'error');
          return;
        }
      } else {
        // Both mode
        if (selectedFiles.length === 0 && !text) {
          showToast('Please select at least one file or enter a text message.', 'error');
          return;
        }
      }

      // Check total size
      const totalBytes = selectedFiles.reduce((acc, item) => acc + item.file.size, 0);
      if (activeShareMode !== 'text' && totalBytes > MAX_TOTAL_SIZE) {
        showToast('Total file size exceeds 100MB limit. Please remove some files.', 'error');
        return;
      }

      // Get selected expiry (Default: 24 Hours = 1440 mins)
      const selectedExpiryRadio = document.querySelector('input[name="expiryMinutes"]:checked');
      const expiryMinutes = selectedExpiryRadio ? selectedExpiryRadio.value : '1440';

      // Advanced inputs
      const password = (passwordInput?.value || '').trim();
      const downloadLimit = (downloadLimitInput?.value || '').trim();

      // Prepare FormData
      const formData = new FormData();

      // Attach text if in text or both mode
      if (activeShareMode === 'text' || activeShareMode === 'both') {
        formData.append('textContent', text);
      } else {
        formData.append('textContent', '');
      }

      formData.append('expiryMinutes', expiryMinutes);
      if (password) formData.append('password', password);
      if (downloadLimit) formData.append('downloadLimit', downloadLimit);

      // Attach files if in files or both mode
      if (activeShareMode === 'files' || activeShareMode === 'both') {
        selectedFiles.forEach(item => {
          formData.append('files', item.file);
        });
      }

      // UI state: uploading
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
      if (progressContainer) {
        progressContainer.style.display = 'block';
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStatus.textContent = 'Uploading your files securely...';
      }

      // Execute upload with XHR for real upload progress
      const xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open('POST', '/api/shares');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 95); // Up to 95% during network transmit
          if (progressBarFill) progressBarFill.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
        }
      };

      xhr.onload = () => {
        activeXhr = null;
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Generate Code';

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success && response.data) {
              if (progressBarFill) progressBarFill.style.width = '100%';
              if (progressPercent) progressPercent.textContent = '100%';
              if (progressStatus) progressStatus.textContent = 'Complete!';

              showSuccessScreen(response.data);
            } else {
              showToast(response.error || 'Upload failed.', 'error');
              if (progressContainer) progressContainer.style.display = 'none';
            }
          } catch (jsonErr) {
            showToast('Invalid server response.', 'error');
            if (progressContainer) progressContainer.style.display = 'none';
          }
        } else {
          try {
            const errResponse = JSON.parse(xhr.responseText);
            showToast(errResponse.error || 'Upload error.', 'error');
          } catch (e) {
            showToast(`Server returned error ${xhr.status}`, 'error');
          }
          if (progressContainer) progressContainer.style.display = 'none';
        }
      };

      xhr.onerror = () => {
        activeXhr = null;
        uploadBtn.disabled = false;
        updateUploadButtonText();
        if (progressContainer) progressContainer.style.display = 'none';
        showToast('Network error while uploading. Please check your connection and retry.', 'error');
      };

      xhr.onabort = () => {
        activeXhr = null;
      };

      xhr.send(formData);
    });
  }

  // 6. Show Success Screen
  async function showSuccessScreen(data) {
    if (uploadCard) uploadCard.style.display = 'none';
    if (successCard) successCard.style.display = 'block';

    currentShareCode = data.shareCode;
    currentDeletionToken = data.deletionToken;

    // Save deletion token in sessionStorage for owner access during this session
    sessionStorage.setItem(`qs_del_${data.shareCode}`, data.deletionToken);

    if (shareCodeText) shareCodeText.textContent = data.shareCode;
    if (statExpires) statExpires.textContent = formatDateTime(data.expiresAt);
    if (statFiles) statFiles.textContent = `${data.fileCount} file(s)`;
    if (statSize) statSize.textContent = formatBytes(data.totalSizeBytes);
    if (statLimit) statLimit.textContent = data.downloadLimit ? `${data.downloadLimit} downloads` : 'Unlimited';

    // Fetch and display QR Code
    try {
      const qrRes = await fetch(`/api/shares/${data.shareCode}/qr`);
      const qrJson = await qrRes.json();
      if (qrJson.success && qrJson.dataUrl && qrCodeImg) {
        qrCodeImg.src = qrJson.dataUrl;
      }
    } catch (qrErr) {
      console.warn('Failed to load QR code:', qrErr);
    }

    // Scroll to top of card
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 7. Copy Code Button
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      if (currentShareCode) {
        copyToClipboard(currentShareCode, 'Share code copied to clipboard!');
      }
    });
  }

  // 8. Copy Share Link Button
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      if (currentShareCode) {
        const shareUrl = `${window.location.origin}/receive.html?code=${encodeURIComponent(currentShareCode)}`;
        copyToClipboard(shareUrl, 'Share link copied to clipboard!');
      }
    });
  }

  // 9. Delete Share Button
  if (deleteShareBtn) {
    deleteShareBtn.addEventListener('click', async () => {
      if (!currentShareCode || !currentDeletionToken) return;

      const confirmed = confirm('Are you sure you want to permanently delete this share and all its files? This action cannot be undone.');
      if (!confirmed) return;

      deleteShareBtn.disabled = true;
      deleteShareBtn.textContent = 'Deleting...';

      try {
        const res = await fetch(`/api/shares/${encodeURIComponent(currentShareCode)}`, {
          method: 'DELETE',
          headers: {
            'x-deletion-token': currentDeletionToken
          }
        });
        const result = await res.json();

        if (res.ok && result.success) {
          showToast('Share deleted permanently.', 'success');
          sessionStorage.removeItem(`qs_del_${currentShareCode}`);
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else {
          showToast(result.error || 'Failed to delete share.', 'error');
          deleteShareBtn.disabled = false;
          deleteShareBtn.textContent = 'Delete Share Now';
        }
      } catch (delErr) {
        showToast('Network error while deleting share.', 'error');
        deleteShareBtn.disabled = false;
        deleteShareBtn.textContent = 'Delete Share Now';
      }
    });
  }

  // 10. "Create Another Share" button
  if (newShareBtn) {
    newShareBtn.addEventListener('click', () => {
      // Clean up object URLs
      selectedFiles.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      selectedFiles = [];
      if (textContent) textContent.value = '';
      if (charCounter) charCounter.textContent = '0 / 100,000 characters';
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.type = 'password';
        const eyeIcon = toggleUploadPasswordBtn?.querySelector('.eye-icon');
        const eyeSlashIcon = toggleUploadPasswordBtn?.querySelector('.eye-slash-icon');
        if (eyeIcon && eyeSlashIcon) {
          eyeIcon.style.display = 'block';
          eyeSlashIcon.style.display = 'none';
        }
      }
      if (downloadLimitInput) downloadLimitInput.value = '';
      if (totalSizeInfo) totalSizeInfo.textContent = '';
      if (progressContainer) progressContainer.style.display = 'none';
      updateUploadButtonText();
      renderSelectedFiles();

      if (successCard) successCard.style.display = 'none';
      if (uploadCard) uploadCard.style.display = 'block';
    });
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    selectedFiles.forEach(item => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  });
});
