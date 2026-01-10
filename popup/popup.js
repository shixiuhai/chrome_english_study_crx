class WordBook {
  constructor() {
    this.wordListElement = document.getElementById('wordList');
    this.searchInput = document.querySelector('.search-box input');
    this.words = [];
    this.userId = '';
    this.currentDomain = '';
    
    this.init();
    this.initDialog();
    this.initDomainExclusion();
  }

  // 初始化对话框
  initDialog() {
    // 关闭按钮事件
    document.querySelector('.dialog-close').addEventListener('click', () => {
      this.hideDialog();
    });
    
    // 点击遮罩层关闭对话框
    document.getElementById('dialogOverlay').addEventListener('click', () => {
      this.hideDialog();
    });
    
    // ESC键关闭对话框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideDialog();
      }
    });
  }
  
  // 显示自定义对话框
  showDialog(title, message, options = {}) {
    const { 
      type = 'alert', 
      primaryBtn = '确定', 
      secondaryBtn = '取消', 
      onPrimary, 
      onSecondary 
    } = options;
    
    // 设置标题和内容
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogBody').textContent = message;
    
    // 设置按钮
    const footer = document.getElementById('dialogFooter');
    footer.innerHTML = '';
    
    // 主按钮
    const primaryButton = document.createElement('button');
    primaryButton.className = 'dialog-btn dialog-btn-primary';
    primaryButton.textContent = primaryBtn;
    primaryButton.addEventListener('click', () => {
      this.hideDialog();
      if (onPrimary) onPrimary();
    });
    footer.appendChild(primaryButton);
    
    // 只有confirm类型才显示次要按钮
    if (type === 'confirm') {
      const secondaryButton = document.createElement('button');
      secondaryButton.className = 'dialog-btn dialog-btn-secondary';
      secondaryButton.textContent = secondaryBtn;
      secondaryButton.addEventListener('click', () => {
        this.hideDialog();
        if (onSecondary) onSecondary();
      });
      footer.appendChild(secondaryButton);
    }
    
    // 显示对话框
    document.getElementById('customDialog').classList.add('dialog-show');
    document.getElementById('dialogOverlay').classList.add('dialog-show');
  }
  
  // 隐藏自定义对话框
  hideDialog() {
    document.getElementById('customDialog').classList.remove('dialog-show');
    document.getElementById('dialogOverlay').classList.remove('dialog-show');
  }
  
  // 替换alert方法
  alert(message, title = '提示') {
    return new Promise((resolve) => {
      this.showDialog(title, message, {
        onPrimary: resolve
      });
    });
  }
  
  // 替换confirm方法
  confirm(message, title = '确认') {
    return new Promise((resolve) => {
      this.showDialog(title, message, {
        type: 'confirm',
        onPrimary: () => resolve(true),
        onSecondary: () => resolve(false)
      });
    });
  }

  // 添加朗读方法
  async speakWord(word) {
    try {
      // 词组直接使用TTS
      if (word.includes(' ')) {
        this.fallbackTTS(word);
        await this.incrementReviewCount(word);
        return;
      }

      // 尝试获取API音频URL
      const phoneticsData = await this.getPhonetics(word);
      if (phoneticsData.audioUrl) {
        try {
          const audio = new Audio(phoneticsData.audioUrl);
          audio.preload = 'auto';
          audio.onerror = () => this.fallbackTTS(word);
          await audio.play();
          await this.incrementReviewCount(word);
          return;
        } catch (e) {
          console.error('API音频播放失败:', e);
        }
      }
      
      // 回退到TTS
      this.fallbackTTS(word);
      await this.incrementReviewCount(word);
    } catch (error) {
      console.error('播放发音失败:', error);
      this.fallbackTTS(word);
    }
  }
  
  async incrementReviewCount(word) {
    try {
      await chrome.runtime.sendMessage({
        type: 'update_review_count',
        word
      });
    } catch (error) {
      console.error('更新复习次数失败:', error);
    }
  }
  
  fallbackTTS(word) {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    try {
      speechSynthesis.speak(utterance);
    } catch (e) {
      console.error('TTS失败:', e);
    }
  }
  
  async init() {
    this.setupLoadingUI();
    try {
      // 加载用户ID配置
      await this.loadUserId();
      // 设置同步事件监听
      this.setupSyncEventListeners();
      // 加载单词
      await this.loadWords();
      this.renderWordList();
      this.setupEventListeners();
    } catch (error) {
      this.showError('加载单词本失败，请重试');
    }
  }

  // 加载用户ID
  async loadUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['userId', 'lastSyncTimestamp'], (result) => {
        this.userId = result.userId || '';
        document.getElementById('userIdInput').value = this.userId;
        this.updateUserIdUI(); // 新增：更新UI状态
        resolve();
      });
    });
  }

  // 保存用户ID
  async saveUserId() {
    const userId = document.getElementById('userIdInput').value.trim();
    if (!userId) {
      await this.alert('请输入有效的用户ID');
      return;
    }
    
    // 增强确认机制：任何修改操作都显示确认提示
    if (this.userId) {
      // 如果是修改已存在的用户ID，显示确认提示
      if (this.userId !== userId) {
        const confirmed = await this.confirm(
          '修改用户ID将影响单词本同步，确定要继续吗？', 
          '修改确认'
        );
        if (!confirmed) {
          // 恢复原用户ID
          document.getElementById('userIdInput').value = this.userId;
          return;
        }
      }
    }
    
    await chrome.storage.local.set({ userId });
    this.userId = userId;
    this.updateUserIdUI();
    this.alert('用户ID保存成功');
  }
  
  // 清除用户ID
  async clearUserId() {
    if (!this.userId) return;
    
    const confirmed = await this.confirm('确定要清除用户ID吗？', '清除确认');
    if (!confirmed) return;
    
    await chrome.storage.local.remove('userId');
    this.userId = '';
    document.getElementById('userIdInput').value = '';
    this.updateUserIdUI();
    this.alert('用户ID已清除');
  }
  
  // 更新用户ID UI状态
  updateUserIdUI() {
    const saveBtn = document.getElementById('saveUserIdBtn');
    const clearBtn = document.getElementById('clearUserIdBtn');
    
    if (this.userId) {
      saveBtn.textContent = '修改';
      clearBtn.style.display = 'inline-block';
    } else {
      saveBtn.textContent = '保存';
      clearBtn.style.display = 'none';
    }
  }

  // 设置同步事件监听
  setupSyncEventListeners() {
    // 保存用户ID
    document.getElementById('saveUserIdBtn').addEventListener('click', () => {
      this.saveUserId();
    });
    
    // 清除用户ID
    document.getElementById('clearUserIdBtn').addEventListener('click', () => {
      this.clearUserId();
    });

    // 拉取单词本
    document.getElementById('downloadBtn').addEventListener('click', async () => {
      await this.downloadWordbook();
    });

    // 同步单词本
    document.getElementById('uploadBtn').addEventListener('click', async () => {
      await this.uploadWordbook();
    });

    // 删除远程单词本
    document.getElementById('deleteBtn').addEventListener('click', async () => {
      await this.deleteRemoteWordbook();
    });
  }

  // 上传单词本
  async uploadWordbook() {
    if (!this.userId) {
      await this.alert('请先设置用户ID');
      return;
    }

    try {
      // 1. 获取当前本地数据
      const localDictionary = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {type: 'get_dictionary'},
          (response) => {
            resolve(response?.dictionary || {});
          }
        );
      });

      // 2. 下载服务器最新数据（新增：上传前先获取服务器最新数据）
      const serverResponse = await this.callSyncAPI('download', { userId: this.userId });
      const serverWordbook = serverResponse.success ? serverResponse.wordbook : [];
      
      // 3. 转换服务器数据为本地格式
      const serverDictionary = {};
      serverWordbook.forEach(wordData => {
        serverDictionary[wordData.word] = {
          translation: wordData.translation,
          phonetics: wordData.phonetics,
          added: wordData.added,
          reviewed: wordData.reviewed || 0,
          lastModified: wordData.lastModified || wordData.added // 兼容旧数据
        };
      });

      // 4. 合并数据：保留每个单词的最新版本
      const mergedDictionary = { ...serverDictionary };
      
      Object.entries(localDictionary).forEach(([word, localData]) => {
        const serverData = serverDictionary[word];
        const localLastModified = localData.lastModified || localData.added || Date.now();
        const serverLastModified = serverData?.lastModified || serverData?.added || 0;
        
        // 如果本地数据更新，或服务器没有该数据，则保留本地数据
        if (!serverData || localLastModified > serverLastModified) {
          mergedDictionary[word] = {
            ...localData,
            lastModified: localLastModified // 确保lastModified存在
          };
        }
      });

      // 5. 转换为API需要的格式（合并后的数据）
      const wordbook = Object.entries(mergedDictionary).map(([word, data]) => {
        return {
          word,
          translation: data.translation,
          phonetics: data.phonetics || '',
          added: data.added,
          reviewed: data.reviewed || 0,
          lastModified: data.lastModified || Date.now() // 确保lastModified存在
        };
      });

      // 6. 调用上传API
      const uploadResponse = await this.callSyncAPI('upload', {
        userId: this.userId,
        wordbook
      });

      if (uploadResponse.success) {
        // 保存服务器返回的时间戳
        await new Promise((resolve) => {
          chrome.storage.local.set({ lastSyncTimestamp: uploadResponse.timestamp }, resolve);
        });
        await this.alert(`单词本同步成功，共 ${wordbook.length} 个单词`);
      } else {
        await this.alert('单词本同步失败: ' + uploadResponse.message);
      }
    } catch (error) {
      console.error('上传单词本失败:', error);
      await this.alert('上传单词本失败，请检查网络连接');
    }
  }

  // 拉取单词本
  async downloadWordbook() {
    if (!this.userId) {
      await this.alert('请先设置用户ID');
      return;
    }

    try {
      // 获取本地上次同步时间戳
      const lastSyncTimestamp = await new Promise((resolve) => {
        chrome.storage.local.get(['lastSyncTimestamp'], (result) => {
          resolve(result.lastSyncTimestamp || 0);
        });
      });

      // 调用下载API
      const response = await this.callSyncAPI('download', { userId: this.userId });

      if (response.success) {
        const wordbook = response.wordbook || [];
        
        // 检查时间戳一致性：只有当lastSyncTimestamp不为0且远程时间戳确实较旧时，才跳过更新
        const serverTimestamp = response.timestamp || 0;
        if (lastSyncTimestamp > 0 && serverTimestamp <= lastSyncTimestamp && wordbook.length === 0) {
          await this.alert('当前单词本已是最新版本，无需更新');
          return;
        }

        if (wordbook.length === 0) {
          await this.alert('远程单词本为空');
          return;
        }

        // 转换为本地存储格式
        const dictionary = {};
        wordbook.forEach(wordData => {
          dictionary[wordData.word] = {
            translation: wordData.translation,
            phonetics: wordData.phonetics,
            added: wordData.added,
            reviewed: wordData.reviewed || 0
          };
        });

        // 保存到本地
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {type: 'save_dictionary', dictionary},
            () => {
              resolve();
            }
          );
        });

        // 保存最新的同步时间戳
        await new Promise((resolve) => {
          chrome.storage.local.set({ lastSyncTimestamp: response.timestamp }, resolve);
        });

        // 重新加载单词本
        await this.loadWords();
        this.renderWordList();
        
        await this.alert(`单词本拉取成功，共 ${wordbook.length} 个单词`);
      } else {
        await this.alert('单词本拉取失败: ' + response.message);
      }
    } catch (error) {
      console.error('拉取单词本失败:', error);
      await this.alert('拉取单词本失败，请检查网络连接');
    }
  }

  // 删除远程单词本
  async deleteRemoteWordbook() {
    if (!this.userId) {
      await this.alert('请先设置用户ID');
      return;
    }

    if (!(await this.confirm('确定要删除远程单词本吗？此操作不可恢复！'))) {
      return;
    }

    try {
      // 调用删除API
      const response = await this.callSyncAPI('delete', { userId: this.userId });

      if (response.success) {
        await this.alert('远程单词本删除成功');
      } else {
        await this.alert('远程单词本删除失败: ' + response.message);
      }
    } catch (error) {
      console.error('删除远程单词本失败:', error);
      await this.alert('删除远程单词本失败，请检查网络连接');
    }
  }

  // 调用同步API
  async callSyncAPI(action, data) {
    let url = '';
    let method = '';
    let params = null;

    switch (action) {
      case 'upload':
        url = `${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.SYNC_UPLOAD}`;
        method = 'POST';
        params = JSON.stringify(data);
        break;
      case 'download':
        url = `${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.SYNC_DOWNLOAD}?userId=${encodeURIComponent(data.userId)}`;
        method = 'GET';
        break;
      case 'delete':
        url = `${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.SYNC_DELETE}?userId=${encodeURIComponent(data.userId)}`;
        method = 'GET';
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method,
      headers,
      body: params
    });

    return await response.json();
  }

  

  async getPhonetics(word) {
    try {
      // 如果是词组(包含空格)，跳过音标获取
      if (word.includes(' ')) {
        return { phoneticText: '', audioUrl: '' };
      }
      
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'get_phonetics', word},
          response => {
            if (chrome.runtime.lastError) {
              // 特别处理扩展上下文被销毁的错误
              if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                console.log('扩展上下文已销毁，跳过获取音标');
                return resolve({ phoneticText: '', audioUrl: '' });
              }
              console.error('获取音标失败:', chrome.runtime.lastError);
              return resolve({ phoneticText: '', audioUrl: '' });
            }
            // 注意：background.js返回的是 {phonetics: {...}} 结构
            const phoneticsData = response?.phonetics || {};
            resolve({
              phoneticText: phoneticsData?.phoneticText || '',
              audioUrl: phoneticsData?.audioUrl || ''
            });
          }
        );
      });
    } catch (error) {
      // 特别处理扩展上下文被销毁的错误
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，跳过获取音标');
        return { phoneticText: '', audioUrl: '' };
      }
      console.error('获取音标失败:', error);
      return { phoneticText: '', audioUrl: '' };
    }
  }

  setupLoadingUI() {
    this.wordListElement.innerHTML = '<div class="loading">加载单词本中...</div>';
  }

  showError(message) {
    this.wordListElement.innerHTML = `<div class="error">${message}</div>`;
  }

  async loadWords() {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'get_dictionary'},
          async (response) => {
            if (chrome.runtime.lastError) {
              // 特别处理扩展上下文被销毁的错误
              if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                console.log('扩展上下文已销毁，显示空单词本');
                this.words = [];
                this.showError('扩展上下文已更新，请重新打开插件');
                return resolve();
              }
              console.error('获取单词本失败:', chrome.runtime.lastError);
              this.showError('连接插件失败');
              return resolve();
            }
            
            try {
              const entries = Object.entries(response?.dictionary || {});
              this.words = entries.map(([word, data]) => {
                return {
                  word,
                  translation: data?.translation || '',
                  phonetics: data?.phonetics || '',
                  added: data?.added || Date.now(),
                  reviewed: data?.reviewed || 0
                };
              });
              this.words.sort((a, b) => b.added - a.added);
              resolve();
            } catch (error) {
              console.error('加载单词出错:', error);
              this.showError('加载单词数据出错');
              resolve();
            }
          }
        );
      });
    } catch (error) {
      // 特别处理扩展上下文被销毁的错误
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，显示空单词本');
        this.words = [];
        this.showError('扩展上下文已更新，请重新打开插件');
        return Promise.resolve();
      }
      console.error('加载单词时出错:', error);
      this.showError('加载单词本失败');
      return Promise.resolve();
    }
  }

  renderWordList() {
    this.wordListElement.innerHTML = '';
    
    if (this.words.length === 0) {
      this.wordListElement.innerHTML = '<div class="empty">单词本为空</div>';
      return;
    }
    
    this.words.forEach((wordData, index) => {
      const wordCard = document.createElement('div');
      wordCard.className = 'word-card';
      wordCard.dataset.word = wordData.word;
      
      wordCard.innerHTML = `
        <div class="word-header">
          <span class="word-text">${wordData.word}</span>
          <div class="word-actions">
            <button class="speak-btn" title="朗读">🔊</button>
            <button class="edit-btn" title="编辑">✏️</button>
            ${!wordData.word.includes(' ') ? `<button class="phonetic-btn" title="获取音标">🔤</button>` : ''}
            <button class="delete-btn" title="删除">🗑️</button>
          </div>
        </div>
        <div class="word-body">
          <div class="word-translation">${wordData.translation || '暂无翻译'}</div>
          ${wordData.phonetics ? `<div class="word-phonetics">/${wordData.phonetics}/</div>` : ''}
          <div class="word-meta">
            <span>添加于 ${new Date(wordData.added).toLocaleDateString()}</span>
            <span>复习次数: ${wordData.reviewed}</span>
          </div>
        </div>
      `;
      
      this.wordListElement.appendChild(wordCard);
    });
  }

  setupEventListeners() {
    // 搜索功能
    this.searchInput.addEventListener('input', this.handleSearch.bind(this));
    
    // 删除单词
    this.wordListElement.addEventListener('click', this.handleWordActions.bind(this));
  }

  // 初始化域名排除功能
  async initDomainExclusion() {
    // 获取当前标签页的域名
    this.currentDomain = await this.getCurrentTabDomain();
    document.getElementById('currentDomain').textContent = this.currentDomain;
    
    // 加载已排除的域名列表
    await this.loadExcludedDomains();
    
    // 添加事件监听
    this.setupDomainExclusionEventListeners();
    
    // 初始化高级配置折叠功能
    this.setupAdvancedConfigToggle();
  }
  
  // 添加高级配置折叠功能
  setupAdvancedConfigToggle() {
    const toggleBtn = document.querySelector('.toggle-config-btn');
    const configContent = document.querySelector('.advanced-config-content');
    const toggleIcon = toggleBtn.querySelector('.toggle-icon');
    
    toggleBtn.addEventListener('click', () => {
      const isVisible = configContent.style.display === 'block';
      configContent.style.display = isVisible ? 'none' : 'block';
      toggleIcon.textContent = isVisible ? '▼' : '▲';
    });
  }

  // 获取当前标签页的域名
  async getCurrentTabDomain() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url) {
          try {
            const url = new URL(tabs[0].url);
            resolve(url.hostname);
          } catch (error) {
            resolve('');
          }
        } else {
          resolve('');
        }
      });
    });
  }

  // 加载已排除的域名列表
  async loadExcludedDomains() {
    const excludedDomains = await this.getExcludedDomains();
    this.renderExcludedDomains(excludedDomains);
  }

  // 获取已排除的域名列表
  async getExcludedDomains() {
    const result = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.EXCLUDED_DOMAINS]);
    return result[CONFIG.STORAGE_KEYS.EXCLUDED_DOMAINS] || [];
  }

  // 渲染已排除的域名列表
  renderExcludedDomains(excludedDomains) {
    const container = document.getElementById('excludedDomainsList');
    container.innerHTML = '';
    
    if (excludedDomains.length === 0) {
      container.innerHTML = '<div style="font-size: 11px; color: var(--text-light); padding: 4px;">暂无排除域名</div>';
      return;
    }
    
    excludedDomains.forEach(domain => {
      const domainTag = document.createElement('div');
      domainTag.className = 'domain-tag';
      domainTag.innerHTML = `
        <span>${domain}</span>
        <button class="remove-domain-btn" data-domain="${domain}">&times;</button>
      `;
      container.appendChild(domainTag);
    });
  }

  // 添加域名排除事件监听
  setupDomainExclusionEventListeners() {
    // 排除当前域名按钮
    document.getElementById('excludeDomainBtn').addEventListener('click', () => {
      this.excludeCurrentDomain();
    });
    
    // 移除已排除域名按钮（使用事件委托）
    document.getElementById('excludedDomainsList').addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-domain-btn')) {
        const domain = e.target.dataset.domain;
        this.removeExcludedDomain(domain);
      }
    });
  }

  // 排除当前域名
  async excludeCurrentDomain() {
    if (!this.currentDomain) {
      await this.alert('无法获取当前域名');
      return;
    }
    
    const excludedDomains = await this.getExcludedDomains();
    
    if (excludedDomains.includes(this.currentDomain)) {
      await this.alert('当前域名已在排除列表中');
      return;
    }
    
    // 显示确认对话框
    const confirmed = await this.confirm(
      `确定要排除当前域名 "${this.currentDomain}" 吗？排除后插件将不再在此域名上运行。`,
      '排除域名确认'
    );
    
    if (!confirmed) return;
    
    // 添加到排除列表
    const updatedDomains = [...excludedDomains, this.currentDomain];
    await this.saveExcludedDomains(updatedDomains);
    
    // 更新UI
    this.renderExcludedDomains(updatedDomains);
    await this.alert(`已成功排除域名 "${this.currentDomain}"`);
  }

  // 移除已排除的域名
  async removeExcludedDomain(domain) {
    const excludedDomains = await this.getExcludedDomains();
    const updatedDomains = excludedDomains.filter(d => d !== domain);
    
    await this.saveExcludedDomains(updatedDomains);
    this.renderExcludedDomains(updatedDomains);
    await this.alert(`已成功移除排除域名 "${domain}"`);
  }

  // 保存已排除的域名列表
  async saveExcludedDomains(domains) {
    await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.EXCLUDED_DOMAINS]: domains });
  }

  handleSearch() {
    const term = this.searchInput.value.toLowerCase().trim();
    this.wordListElement.querySelectorAll('.word-card').forEach(card => {
      const word = card.dataset.word.toLowerCase();
      card.style.display = word.includes(term) ? '' : 'none';
    });
  }

  handleWordActions(e) {
    if (e.target.classList.contains('delete-btn')) {
      this.handleDeleteWord(e);
    } 
    else if (e.target.classList.contains('edit-btn')) {
      this.handleEditWord(e);
    } else if (e.target.classList.contains('phonetic-btn')) {
      this.handleGetPhonetic(e);
    }
  }

  async handleDeleteWord(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    
    if (!(await this.confirm(`确定要删除单词 "${word}" 吗？`))) return;
    
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {type: 'delete_word', word},
          () => {
            if (chrome.runtime.lastError) {
              console.error('删除单词失败:', chrome.runtime.lastError);
              this.showError('删除单词失败');
              return;
            }
            resolve();
          }
        );
      });
      
      await this.loadWords();
      this.renderWordList();
    } catch (error) {
      console.error('删除出错:', error);
      this.showError('删除单词时出错');
    }
  }
  
  async handleGetPhonetic(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    
    // 显示加载状态
    const phoneticBtn = card.querySelector('.phonetic-btn');
    const originalIcon = phoneticBtn.innerHTML;
    phoneticBtn.innerHTML = '⏳';
    phoneticBtn.disabled = true;
    
    try {
      // 获取音标
      const phoneticsData = await this.getPhonetics(word);
      
      if (phoneticsData.phoneticText) {
        // 更新单词本中的音标
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'update_phonetic',
              word,
              phonetic: phoneticsData.phoneticText
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('更新音标失败:', chrome.runtime.lastError);
              }
              resolve();
            }
          );
        });
        
        // 重新加载单词并渲染列表
        await this.loadWords();
        this.renderWordList();
      }
      // 没有音标时直接跳过，不显示任何提示
    } catch (error) {
      console.error('获取音标出错:', error);
      // 出错时也不显示提示，直接跳过
    } finally {
      // 恢复按钮状态
      phoneticBtn.innerHTML = originalIcon;
      phoneticBtn.disabled = false;
    }
  }

  handleEditWord(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    const translationDiv = card.querySelector('.word-translation');
    
    const originalText = translationDiv.textContent;
    translationDiv.innerHTML = `
      <textarea class="edit-area">${originalText}</textarea>
      <div class="edit-actions">
        <button class="save-edit-btn">保存</button>
        <button class="cancel-edit-btn">取消</button>
      </div>
    `;
    
    const textarea = translationDiv.querySelector('.edit-area');
    textarea.focus();
    
    translationDiv.querySelector('.save-edit-btn').addEventListener('click', () => {
      this.saveWordEdit(word, textarea.value.trim(), card);
    });
    
    translationDiv.querySelector('.cancel-edit-btn').addEventListener('click', () => {
      translationDiv.textContent = originalText;
    });
  }

  async saveWordEdit(word, newTranslation, card) {
    if (!newTranslation) {
      await this.alert('翻译内容不能为空');
      return;
    }
    
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'update_translation',
            word,
            translation: newTranslation
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('更新翻译失败:', chrome.runtime.lastError);
              this.showError('保存翻译失败');
              return;
            }
            resolve();
          }
        );
      });
      
      await this.loadWords();
      this.renderWordList();
    } catch (error) {
      console.error('保存翻译出错:', error);
      this.showError('保存翻译时出错');
    }
  }
}

// 初始化单词本
document.addEventListener('DOMContentLoaded', () => {
  const wordBook = new WordBook();
  
  // 监听存储变化，实时更新单词本
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.word_dictionary) {
      wordBook.loadWords().then(() => {
        wordBook.renderWordList();
      });
    }
  });
  
  // 添加全局朗读点击处理
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('speak-btn')) {
      const word = e.target.closest('.word-card').dataset.word;
      wordBook.speakWord(word);
    }
  });
});