import { formatBytes, formatDateTime, showToast, copyToClipboard, initMobileNav } from './common.js';

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();

  // State
  let selectedFiles = [];
  const MAX_FILE_COUNT = 10;
  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
  const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50 MB
  const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.doc', '.docx'];

  // DOM Elements
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
  const downloadLimitInput = document.getElementById('download-limit-input');
  const uploadBtn = document.getElementById('upload-btn');
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

  // Active Share Deletion State
  let currentShareCode = null;
  let currentDeletionToken = null;

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
        showToast(`"${file.name}" has an unsupported format. Supported: PDF, JPG, PNG, WEBP, TXT, DOC, DOCX.`, 'error');
        continue;
      }

      // Check single file size
      if (file.size > MAX_FILE_SIZE) {
        showToast(`"${file.name}" exceeds 25MB limit.`, 'error');
        continue;
      }

      // Check duplicate
      const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
      if (!isDuplicate) {
        selectedFiles.push(file);
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
    selectedFiles.forEach((file, index) => {
      totalBytes += file.size;

      const item = document.createElement('div');
      item.className = 'file-item';

      const info = document.createElement('div');
      info.className = 'file-item-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name';
      nameSpan.textContent = file.name;
      nameSpan.title = file.name;

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'file-size';
      sizeSpan.textContent = `(${formatBytes(file.size)})`;

      info.appendChild(nameSpan);
      info.appendChild(sizeSpan);

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
        selectedFiles.splice(index, 1);
        renderSelectedFiles();
      });

      item.appendChild(info);
      item.appendChild(removeBtn);
      selectedFilesList.appendChild(item);
    });

    if (totalSizeInfo) {
      totalSizeInfo.textContent = `Total: ${selectedFiles.length} file(s), ${formatBytes(totalBytes)} (Max 50MB)`;
      if (totalBytes > MAX_TOTAL_SIZE) {
        totalSizeInfo.style.color = 'var(--danger)';
      } else {
        totalSizeInfo.style.color = 'var(--text-muted)';
      }
    }
  }

  // 4. Submit Upload
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      const text = (textContent?.value || '').trim();
      if (selectedFiles.length === 0 && !text) {
        showToast('Please select at least one file or enter a text message.', 'error');
        return;
      }

      // Check total size
      const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
      if (totalBytes > MAX_TOTAL_SIZE) {
        showToast('Total file size exceeds 50MB limit. Please remove some files.', 'error');
        return;
      }

      // Get selected expiry
      const selectedExpiryRadio = document.querySelector('input[name="expiryMinutes"]:checked');
      const expiryMinutes = selectedExpiryRadio ? selectedExpiryRadio.value : '30';

      // Advanced inputs
      const password = (passwordInput?.value || '').trim();
      const downloadLimit = (downloadLimitInput?.value || '').trim();

      // Prepare FormData
      const formData = new FormData();
      formData.append('textContent', text);
      formData.append('expiryMinutes', expiryMinutes);
      if (password) formData.append('password', password);
      if (downloadLimit) formData.append('downloadLimit', downloadLimit);

      selectedFiles.forEach(file => {
        formData.append('files', file);
      });

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
      xhr.open('POST', '/api/shares');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 95); // Up to 95% during network transmit
          if (progressBarFill) progressBarFill.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
        }
      };

      xhr.onload = () => {
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
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Generate Code';
        if (progressContainer) progressContainer.style.display = 'none';
        showToast('Network error while uploading. Please check your connection and retry.', 'error');
      };

      xhr.send(formData);
    });
  }

  // 5. Show Success Screen
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

  // 6. Copy Code Button
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      if (currentShareCode) {
        copyToClipboard(currentShareCode, 'Share code copied to clipboard!');
      }
    });
  }

  // 7. Copy Share Link Button
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      if (currentShareCode) {
        const shareUrl = `${window.location.origin}/receive.html?code=${encodeURIComponent(currentShareCode)}`;
        copyToClipboard(shareUrl, 'Share link copied to clipboard!');
      }
    });
  }

  // 8. Delete Share Button
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

  // 9. "Create Another Share" button
  if (newShareBtn) {
    newShareBtn.addEventListener('click', () => {
      selectedFiles = [];
      if (textContent) textContent.value = '';
      if (charCounter) charCounter.textContent = '0 / 100,000 characters';
      if (passwordInput) passwordInput.value = '';
      if (downloadLimitInput) downloadLimitInput.value = '';
      if (totalSizeInfo) totalSizeInfo.textContent = '';
      if (progressContainer) progressContainer.style.display = 'none';
      renderSelectedFiles();

      if (successCard) successCard.style.display = 'none';
      if (uploadCard) uploadCard.style.display = 'block';
    });
  }
});
