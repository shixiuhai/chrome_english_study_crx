class WordBookConfig {
  constructor() {
    this.userId = '';
    this.currentDomain = '';
    this.reviewMode = 'standard'; // 默认复习模式
    
    this.init();
    this.initDialog();
    this.initDomainExclusion();
    this.initWordbookLink();
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
  
  async init() {
    try {
      // 加载用户ID配置
      await this.loadUserId();
      // 设置同步事件监听
      this.setupSyncEventListeners();
    } catch (error) {
      console.error('初始化失败:', error);
    }
  }

  // 初始化单词本链接
  initWordbookLink() {
    // 打开单词本按钮事件
    document.getElementById('openWordbookBtn').addEventListener('click', () => {
      this.openWordbook();
    });
  }

  // 打开单词本页面
  openWordbook() {
    // 获取扩展目录中的wordbook.html路径
    const wordbookUrl = chrome.runtime.getURL('wordbook/wordbook.html');
    // 在新标签页中打开
    chrome.tabs.create({ url: wordbookUrl });
  }

  // 加载用户ID和复习模式
  async loadUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['userId', 'lastSyncTimestamp', 'reviewMode'], (result) => {
        this.userId = result.userId || '';
        this.reviewMode = result.reviewMode || 'standard';
        document.getElementById('userIdInput').value = this.userId;
        
        // 更新复习模式选择UI
        this.updateReviewModeUI();
        
        this.updateUserIdUI(); // 新增：更新UI状态
        resolve();
      });
    });
  }
  
  // 更新复习模式选择UI
  updateReviewModeUI() {
    const buttons = document.querySelectorAll('.review-mode-btn');
    buttons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.mode === this.reviewMode) {
        btn.classList.add('active');
        // 更新模式描述
        const desc = document.getElementById('reviewModeDesc');
        if (desc) {
          desc.textContent = btn.dataset.desc;
        }
      }
    });
  }
  
  // 保存复习模式
  async saveReviewMode(mode) {
    this.reviewMode = mode;
    await chrome.storage.local.set({ reviewMode: mode });
    // 更新UI
    this.updateReviewModeUI();
    this.alert('复习模式保存成功');
  }

  // 保存用户ID
  async saveUserId() {
    const userId = document.getElementById('userIdInput').value.trim();
    
    // 验证用户ID必须是11位
    if (!userId) {
      await this.alert('请输入有效的用户ID');
      return;
    }
    
    // 验证用户ID必须是11位数字
    if (userId.length !== 11 || !/^\d+$/.test(userId)) {
      await this.alert('用户ID必须为11位数字，建议使用手机号');
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
    
    // 复习模式按钮组事件监听
    const reviewModeButtons = document.querySelectorAll('.review-mode-btn');
    reviewModeButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.saveReviewMode(btn.dataset.mode);
      });
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
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('保存字典失败:', chrome.runtime.lastError);
              }
              resolve();
            }
          );
        });

        // 保存最新的同步时间戳
        await new Promise((resolve) => {
          chrome.storage.local.set({ lastSyncTimestamp: response.timestamp }, resolve);
        });

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

    try {
      // 设置超时控制，避免请求卡住
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      const response = await fetch(url, {
        method,
        headers,
        body: params,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`调用${action} API失败:`, error);
      // 处理网络错误或超时
      if (error.name === 'AbortError') {
        throw new Error('API请求超时');
      }
      throw error;
    }
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
}

// 初始化配置页面
document.addEventListener('DOMContentLoaded', () => {
  const wordBookConfig = new WordBookConfig();
});