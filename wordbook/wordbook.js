class WordBook {
  constructor() {
    this.wordListElement = document.getElementById('wordList');
    this.searchInput = document.querySelector('.search-box input');
    this.words = [];
    
    this.init();
    this.initDialog();
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
      // 直接使用浏览器原生TTS，不再调用API获取音频
      this.fallbackTTS(word);
      await this.incrementReviewCount(word);
    } catch (error) {
      console.error('播放发音失败:', error);
      this.fallbackTTS(word);
    }
  }
  
  async incrementReviewCount(word, isCorrect = true) {
    try {
      await chrome.runtime.sendMessage({
        type: 'update_review_count',
        word,
        isCorrect
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
      // 加载单词
      await this.loadWords();
      this.renderWordList();
      this.setupEventListeners();
      this.setupReviewButton();
    } catch (error) {
      console.error('初始化失败:', error);
      // 确保在初始化失败时也能显示错误信息并结束加载状态
      this.words = [];
      this.showError('加载单词本失败，请重试');
    }
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
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {type: 'get_dictionary'},
          (response) => {
            // 确保在所有情况下都初始化 this.words
            this.words = [];
            
            if (chrome.runtime.lastError) {
              // 特别处理扩展上下文被销毁的错误
              if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                console.log('扩展上下文已销毁，显示空单词本');
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
                  reviewed: data?.reviewed || 0,
                  correctReviews: data?.correctReviews || 0,
                  lastReviewed: data?.lastReviewed || null,
                  lastModified: data?.lastModified || Date.now()
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
      // 确保在所有情况下都初始化 this.words
      this.words = [];
      
      // 特别处理扩展上下文被销毁的错误
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，显示空单词本');
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
        <div class="word-section">
          <div class="word-card-header">
            <input type="checkbox" class="word-select-checkbox" data-word="${wordData.word}">
            <div class="word-container">
              <span class="word-text">${wordData.word}</span>
              ${wordData.phonetics ? `<span class="word-phonetics">/${wordData.phonetics}/</span>` : ''}
              <div class="tooltip word-tooltip">
                <div class="tooltip-word">${wordData.word}</div>
                ${wordData.phonetics ? `<div class="tooltip-phonetics">/${wordData.phonetics}/</div>` : ''}
              </div>
            </div>
          </div>
          <div class="translation-container">
            <div class="word-translation">${wordData.translation || '暂无翻译'}</div>
            <div class="tooltip translation-tooltip">
              <div class="tooltip-translation">${wordData.translation || '暂无翻译'}</div>
            </div>
          </div>
        </div>
        <div class="word-review-count">
          <small>复习 ${wordData.reviewed || 0} 次</small>
        </div>
        <div class="word-actions">
          <button class="speak-btn" title="朗读">🔊</button>
          <button class="edit-btn" title="编辑">✏️</button>
          ${!wordData.word.includes(' ') ? `<button class="phonetic-btn" title="获取音标">🔤</button>` : ''}
          <button class="review-btn" title="单独复习">📖</button>
          <button class="delete-btn" title="删除">🗑️</button>
        </div>
      `;
      
      this.wordListElement.appendChild(wordCard);
      
      // 添加tooltip事件
      this.setupTooltipEvents(wordCard);
    });
    
    // 设置批量操作事件监听
    this.setupBatchActionListeners();
  }
  
  // 设置tooltip事件
  setupTooltipEvents(card) {
    // 原文tooltip
    const wordContainer = card.querySelector('.word-container');
    const wordTooltip = card.querySelector('.word-tooltip');
    
    if (wordContainer && wordTooltip) {
      wordContainer.addEventListener('mouseenter', () => {
        wordTooltip.classList.add('show');
      });
      
      wordContainer.addEventListener('mouseleave', () => {
        wordTooltip.classList.remove('show');
      });
    }
    
    // 翻译tooltip
    const translationContainer = card.querySelector('.translation-container');
    const translationTooltip = card.querySelector('.translation-tooltip');
    
    if (translationContainer && translationTooltip) {
      translationContainer.addEventListener('mouseenter', () => {
        translationTooltip.classList.add('show');
      });
      
      translationContainer.addEventListener('mouseleave', () => {
        translationTooltip.classList.remove('show');
      });
    }
  }

  setupEventListeners() {
    // 搜索功能
    this.searchInput.addEventListener('input', this.handleSearch.bind(this));
    
    // 删除单词
    this.wordListElement.addEventListener('click', this.handleWordActions.bind(this));
  }
  
  // 设置批量操作事件监听
  setupBatchActionListeners() {
    // 全选/取消全选
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
      // 移除旧的事件监听器，避免重复绑定
      selectAllCheckbox.removeEventListener('change', this.handleSelectAllChange);
      this.handleSelectAllChange = (e) => {
        const isChecked = e.target.checked;
        this.toggleSelectAll(isChecked);
      };
      selectAllCheckbox.addEventListener('change', this.handleSelectAllChange);
    }
    
    // 单个复选框事件 - 使用事件委托，确保动态生成的元素也能触发事件
    this.wordListElement.removeEventListener('change', this.handleCheckboxChange);
    this.handleCheckboxChange = (e) => {
      if (e.target.classList.contains('word-select-checkbox')) {
        this.updateBatchDeleteButton();
        this.updateSelectAllStatus();
      }
    };
    this.wordListElement.addEventListener('change', this.handleCheckboxChange);
    
    // 批量删除按钮
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (batchDeleteBtn) {
      // 移除旧的事件监听器，避免重复绑定
      batchDeleteBtn.removeEventListener('click', this.handleBatchDelete);
      batchDeleteBtn.addEventListener('click', () => {
        this.handleBatchDelete();
      });
    }
  }
  
  // 全选/取消全选 - 只处理可见的单词卡片
  toggleSelectAll(isChecked) {
    const wordCards = document.querySelectorAll('.word-card');
    wordCards.forEach(card => {
      // 只处理可见的卡片
      if (card.style.display !== 'none') {
        const checkbox = card.querySelector('.word-select-checkbox');
        if (checkbox) {
          checkbox.checked = isChecked;
        }
      }
    });
    this.updateBatchDeleteButton();
    this.updateSelectAllStatus();
  }
  
  // 更新批量删除按钮状态
  updateBatchDeleteButton() {
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const selectedCount = this.getSelectedWords().length;
    batchDeleteBtn.disabled = selectedCount === 0;
    batchDeleteBtn.textContent = `🗑️ 批量删除 (${selectedCount})`;
  }
  
  // 更新全选状态 - 只考虑可见的单词卡片
  updateSelectAllStatus() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const wordCards = document.querySelectorAll('.word-card');
    
    // 只获取可见的单词卡片
    const visibleCards = Array.from(wordCards).filter(card => card.style.display !== 'none');
    if (visibleCards.length === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }
    
    const allChecked = visibleCards.every(card => {
      const checkbox = card.querySelector('.word-select-checkbox');
      return checkbox && checkbox.checked;
    });
    const noneChecked = visibleCards.every(card => {
      const checkbox = card.querySelector('.word-select-checkbox');
      return !checkbox || !checkbox.checked;
    });
    
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
  }
  
  // 获取选中的单词 - 只返回可见卡片中选中的单词
  getSelectedWords() {
    const wordCards = document.querySelectorAll('.word-card');
    const selectedWords = [];
    
    wordCards.forEach(card => {
      // 只处理可见的卡片
      if (card.style.display !== 'none') {
        const checkbox = card.querySelector('.word-select-checkbox');
        if (checkbox && checkbox.checked) {
          selectedWords.push(checkbox.dataset.word);
        }
      }
    });
    
    return selectedWords;
  }
  
  // 批量删除处理
  async handleBatchDelete() {
    console.log('批量删除处理开始');
    const selectedWords = this.getSelectedWords();
    console.log('选中的单词:', selectedWords);
    
    if (selectedWords.length === 0) {
      console.log('没有选中的单词，退出批量删除');
      return;
    }
    
    console.log('显示确认对话框');
    if (!(await this.confirm(`确定要删除选中的 ${selectedWords.length} 个单词吗？`))) {
      console.log('用户取消了批量删除');
      return;
    }
    
    try {
      console.log('开始批量删除单词');
      
      // 使用新的批量删除API，避免竞态条件
      console.log('发送批量删除请求:', selectedWords);
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'delete_words', words: selectedWords}, 
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('批量删除失败:', chrome.runtime.lastError);
              reject(chrome.runtime.lastError);
            } else {
              console.log('批量删除成功，响应:', response);
              resolve();
            }
          }
        );
      });
      
      console.log('批量删除完成，重新加载单词');
      // 重新加载单词并渲染列表
      await this.loadWords();
      console.log('单词加载完成，重新渲染列表');
      this.renderWordList();
      
      // 重置全选状态
      const selectAllCheckbox = document.getElementById('selectAllCheckbox');
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      
      console.log(`成功删除 ${selectedWords.length} 个单词`);
      await this.alert(`成功删除 ${selectedWords.length} 个单词`);
    } catch (error) {
      console.error('批量删除出错:', error);
      this.showError('批量删除单词时出错');
    }
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
    } else if (e.target.classList.contains('review-btn')) {
      this.handleSingleReview(e);
    }
  }
  
  // 单独复习处理
  handleSingleReview(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    
    // 查找当前单词的数据
    const wordData = this.words.find(w => w.word === word);
    if (wordData) {
      // 创建只包含当前单词的复习列表
      const reviewWords = [wordData];
      // 调用复习弹窗，只复习当前单词
      this.showReviewDialog(reviewWords);
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
  
  // 设置复习按钮
  setupReviewButton() {
    const reviewBtn = document.getElementById('reviewBtn');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', () => this.handleReview());
    }
  }
  
  // 处理复习逻辑
  async handleReview() {
    if (this.words.length === 0) {
      await this.alert('单词本为空，无法生成复习单词');
      return;
    }
    
    // 检查是否有有效的复习会话
    const session = this.getReviewSession();
    const isValidSession = this.isSessionValid(session);
    
    if (isValidSession) {
      // 显示复习选项对话框
      this.showReviewOptionsDialog(session);
    } else {
      // 没有有效会话，获取保存的复习模式，然后生成新的复习单词
      const savedMode = await new Promise((resolve) => {
        chrome.storage.local.get(['reviewMode'], (result) => {
          resolve(result.reviewMode || 'standard');
        });
      });
      this.generateNewReview(savedMode);
    }
  }
  
  // 显示复习选项对话框
  showReviewOptionsDialog(session) {
    const sessionTimeStr = this.formatTimeDiff(session.createdAt);
    
    const dialogContent = document.getElementById('dialogBody');
    const dialogFooter = document.getElementById('dialogFooter');
    
    // 设置对话框标题和内容
    document.getElementById('dialogTitle').textContent = '复习选项';
    dialogContent.innerHTML = `
      <div class="review-options-content">
        <div class="session-info">
          <p>上次复习：${sessionTimeStr}</p>
          <p>复习进度：${session.currentIndex + 1}/${session.words.length}</p>
        </div>
        <p>请选择复习方式：</p>
      </div>
    `;
    
    // 清空并设置按钮
    dialogFooter.innerHTML = '';
    
    // 继续上一次复习按钮
    const continueBtn = document.createElement('button');
    continueBtn.className = 'dialog-btn dialog-btn-primary';
    continueBtn.textContent = '继续上一次复习';
    continueBtn.addEventListener('click', () => {
      this.hideDialog();
      this.showReviewDialog(session.words, session.currentIndex);
    });
    dialogFooter.appendChild(continueBtn);
    
    // 重新生成复习单词按钮
    const newBtn = document.createElement('button');
    newBtn.className = 'dialog-btn dialog-btn-secondary';
    newBtn.textContent = '重新生成复习单词';
    newBtn.addEventListener('click', async () => {
      this.hideDialog();
      this.clearReviewSession();
      // 获取保存的复习模式
      const savedMode = await new Promise((resolve) => {
        chrome.storage.local.get(['reviewMode'], (result) => {
          resolve(result.reviewMode || 'standard');
        });
      });
      this.generateNewReview(savedMode);
    });
    dialogFooter.appendChild(newBtn);
    
    // 显示对话框
    document.getElementById('customDialog').classList.add('dialog-show');
    document.getElementById('dialogOverlay').classList.add('dialog-show');
  }
  
  // 计算单词记忆强度
  calculateMemoryStrength(word) {
    const now = Date.now();
    const timeSinceAdded = now - word.added;
    const timeSinceLastReview = word.lastReviewed ? now - word.lastReviewed : timeSinceAdded;
    
    // 基础记忆强度
    let strength = 1.0;
    
    // 根据复习次数调整
    strength += word.reviewed * 0.1;
    
    // 根据复习正确率调整（如果有复习记录）
    if (word.reviewed > 0) {
      const correctRate = word.correctReviews / word.reviewed;
      strength += correctRate * 0.3;
    }
    
    // 根据时间间隔衰减（基于艾宾浩斯遗忘曲线）
    // 7天半衰期，使用指数衰减模型
    const decayFactor = Math.exp(-timeSinceLastReview / (86400000 * 7));
    strength *= decayFactor;
    
    // 确保强度在合理范围内
    return Math.max(0.1, Math.min(1.0, strength));
  }
  
  // 生成新的复习单词
  generateNewReview(mode = 'standard') {
    let reviewWords = [];
    const allWords = [...this.words];
    
    // 根据不同模式选择复习单词
    switch (mode) {
      case 'standard':
        // 标准模式：基于记忆强度
        reviewWords = allWords
          .map(word => ({
            ...word,
            memoryStrength: this.calculateMemoryStrength(word)
          }))
          .sort((a, b) => a.memoryStrength - b.memoryStrength)
          .slice(0, 20);
        break;
        
      case 'random':
        // 随机模式：随机选择单词
        reviewWords = [...allWords]
          .sort(() => Math.random() - 0.5)
          .slice(0, 20);
        break;
        
      case 'mixed':
        // 新旧交替模式：新单词和旧单词交替出现
        const newWords = [...allWords]
          .sort((a, b) => b.added - a.added) // 最新添加的单词在前
          .slice(0, 10);
        
        const oldWords = [...allWords]
          .sort((a, b) => a.added - b.added) // 最旧添加的单词在前
          .slice(0, 10);
        
        // 交替合并新单词和旧单词
        reviewWords = [];
        for (let i = 0; i < Math.max(newWords.length, oldWords.length); i++) {
          if (newWords[i]) reviewWords.push(newWords[i]);
          if (oldWords[i]) reviewWords.push(oldWords[i]);
          if (reviewWords.length >= 20) break;
        }
        break;
        
      case 'difficult':
        // 重点突破模式：专注复习错误率高的单词
        reviewWords = allWords
          .filter(word => word.reviewed > 0) // 只选择有复习记录的单词
          .map(word => ({
            ...word,
            errorRate: 1 - (word.correctReviews / word.reviewed)
          }))
          .sort((a, b) => b.errorRate - a.errorRate) // 错误率越高，优先级越高
          .slice(0, 20);
        
        // 如果错误率高的单词不足20个，补充一些记忆强度低的单词
        if (reviewWords.length < 20) {
          const additionalWords = allWords
            .filter(word => !reviewWords.find(w => w.word === word.word))
            .map(word => ({
              ...word,
              memoryStrength: this.calculateMemoryStrength(word)
            }))
            .sort((a, b) => a.memoryStrength - b.memoryStrength)
            .slice(0, 20 - reviewWords.length);
          
          reviewWords = [...reviewWords, ...additionalWords];
        }
        break;
        
      default:
        // 默认使用标准模式
        reviewWords = allWords
          .map(word => ({
            ...word,
            memoryStrength: this.calculateMemoryStrength(word)
          }))
          .sort((a, b) => a.memoryStrength - b.memoryStrength)
          .slice(0, 20);
    }
    
    this.showReviewDialog(reviewWords);
  }
  
  // 显示复习对话框
  showReviewDialog(reviewWords, initialIndex = 0) {
    let currentIndex = initialIndex;
    
    const dialogContent = document.getElementById('dialogBody');
    const dialogFooter = document.getElementById('dialogFooter');
    
    // 创建全局Tooltip元素
    let tooltipElement = null;
    let currentAbortController = null;
    
    // 初始化Tooltip
    const initTooltip = () => {
      tooltipElement = document.createElement('div');
      tooltipElement.className = 'review-tooltip';
      tooltipElement.innerHTML = '<div class="review-tooltip-word"></div><div class="review-tooltip-meaning"></div>';
      document.body.appendChild(tooltipElement);
    };
    
    // 显示Tooltip
    const showTooltip = (target, word, meaning) => {
      if (!tooltipElement) initTooltip();
      
      // 设置Tooltip内容
      tooltipElement.querySelector('.review-tooltip-word').textContent = word;
      tooltipElement.querySelector('.review-tooltip-meaning').textContent = meaning;
      
      // 计算Tooltip位置
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltipElement.getBoundingClientRect();
      
      tooltipElement.style.left = `${targetRect.left + targetRect.width / 2 - tooltipRect.width / 2}px`;
      tooltipElement.style.top = `${targetRect.top - tooltipRect.height - 10}px`;
      
      // 显示Tooltip
      tooltipElement.classList.add('show');
    };
    
    // 隐藏Tooltip
    const hideTooltip = () => {
      if (tooltipElement) {
        tooltipElement.classList.remove('show');
      }
      // 取消当前请求，确保即使controller不存在也不会出错
      if (currentAbortController) {
        try {
          currentAbortController.abort();
        } catch (error) {
          console.debug('取消请求失败:', error);
        }
        currentAbortController = null;
      }
    };
    
    // 获取单词意思
    const fetchWordMeaning = async (word, controller) => {
      try {
        // 从当前单词列表中查找单词意思
        const foundWord = this.words.find(w => w.word.toLowerCase() === word.toLowerCase());
        if (foundWord) {
          // 检查是否已被取消
          if (controller.signal.aborted) {
            throw new Error('Request aborted');
          }
          return foundWord.translation || '暂无翻译';
        }
        
        // 检查是否已被取消
        if (controller.signal.aborted) {
          throw new Error('Request aborted');
        }
        
        // 调用划词翻译接口（不保存到单词本）
        return await new Promise((resolve, reject) => {
          // 监听取消信号
          const abortListener = () => {
            reject(new Error('Request aborted'));
          };
          controller.signal.addEventListener('abort', abortListener);
          
          // 发送翻译请求，使用translate_no_save类型避免自动保存
          chrome.runtime.sendMessage(
            {type: 'translate_no_save', word}, 
            (response) => {
              // 移除取消监听，避免内存泄漏
              controller.signal.removeEventListener('abort', abortListener);
              
              // 检查是否已被取消
              if (controller.signal.aborted) {
                return;
              }
              
              if (chrome.runtime.lastError) {
                console.error('翻译请求失败:', chrome.runtime.lastError);
                return resolve('暂无翻译');
              }
              
              resolve(response.translation || '暂无翻译');
            }
          );
        });
      } catch (error) {
        if (error.name === 'AbortError' || error.message === 'Request aborted') {
          throw error;
        }
        console.error('获取单词意思失败:', error);
        return '暂无翻译';
      }
    };
    
    // 处理鼠标进入事件
    const handleMouseEnter = async (e) => {
      const word = e.target.textContent.trim();
      if (!word) return;
      
      // 首先取消可能存在的旧请求，避免资源浪费
      hideTooltip();
      
      // 显示加载状态
      showTooltip(e.target, word, '加载中...');
      
      // 创建AbortController
      const controller = new AbortController();
      currentAbortController = controller;
      
      try {
        // 获取单词意思
        const meaning = await fetchWordMeaning(word, controller);
        // 检查是否已被取消
        if (controller.signal.aborted) return;
        // 更新Tooltip内容
        showTooltip(e.target, word, meaning);
      } catch (error) {
        // 如果是取消错误，不做处理
        if (error.name !== 'AbortError' && error.message !== 'Request aborted') {
          // 再次检查是否已被取消，防止竞态条件
          if (controller.signal.aborted) return;
          console.error('处理单词翻译时出错:', error);
          showTooltip(e.target, word, '暂无翻译');
        }
      }
    };
    
    // 处理鼠标离开事件
    const handleMouseLeave = () => {
      hideTooltip();
    };
    
    // 设置单词部分事件监听
    const setupWordPartListeners = () => {
      const wordParts = dialogContent.querySelectorAll('.review-word-part');
      wordParts.forEach(part => {
        part.addEventListener('mouseenter', handleMouseEnter);
        part.addEventListener('mouseleave', handleMouseLeave);
      });
    };
    
    // 渲染当前单词
    const renderCurrentWord = async () => {
      const wordData = reviewWords[currentIndex];
      
      // 更新对话框标题
      document.getElementById('dialogTitle').textContent = `复习单词 (${currentIndex + 1}/${reviewWords.length})`;
      
      // 更新对话框内容
      const isPhrase = wordData.word.includes(' ');
      
      // 处理单词组，分离单词和标点符号
      const processWordPhrase = (phrase) => {
        // 使用正则表达式拆分单词和标点符号
        // 匹配规则：
        // \w+ - 一个或多个字母、数字或下划线（单词部分）
        // [^\w\s]+ - 一个或多个非单词、非空格字符（标点符号部分）
        // \s+ - 一个或多个空格（分隔符）
        const parts = phrase.match(/\w+|[^\w\s]+|\s+/g);
        
        return parts.map(part => {
          // 检测是否为单词
          const isWord = /^\w+$/.test(part);
          if (isWord) {
            return `<span class="review-word-part">${part}</span>`;
          } else {
            // 非单词部分（标点符号或空格）直接返回
            return part;
          }
        }).join('');
      };
      
      const wordContent = isPhrase 
        ? processWordPhrase(wordData.word) 
        : wordData.word;
      
      dialogContent.innerHTML = `
        <div class="review-word-container">
          <div class="review-word">${wordContent}</div>
          ${wordData.phonetics ? `<div class="review-phonetics">/${wordData.phonetics}/</div>` : ''}
          <div class="review-translation">${wordData.translation || '暂无翻译'}</div>
        </div>
      `;
      
      // 设置单词部分事件监听
      setupWordPartListeners();
      
      // 保存复习会话
      this.saveReviewSession(reviewWords, currentIndex);
    };
    
    // 初始化对话框
    document.getElementById('dialogTitle').textContent = `复习单词 (${currentIndex + 1}/${reviewWords.length})`;
    dialogFooter.innerHTML = '';
    
    // 添加导航按钮
    const prevBtn = document.createElement('button');
    prevBtn.className = 'dialog-btn dialog-btn-secondary';
    prevBtn.textContent = '上一个';
    prevBtn.disabled = currentIndex === 0;
    
    const correctBtn = document.createElement('button');
    correctBtn.className = 'dialog-btn dialog-btn-primary';
    correctBtn.textContent = '✅ 正确';
    
    const wrongBtn = document.createElement('button');
    wrongBtn.className = 'dialog-btn dialog-btn-secondary';
    wrongBtn.textContent = '❌ 错误';
    
    // 处理复习结果
    const handleReviewResult = async (isCorrect) => {
      const currentWord = reviewWords[currentIndex];
      // 更新复习记录
      await this.incrementReviewCount(currentWord.word, isCorrect);
      
      // 进入下一个单词
      if (currentIndex < reviewWords.length - 1) {
        currentIndex++;
        await renderCurrentWord();
        prevBtn.disabled = false;
      } else {
        // 复习完成，清除会话
        this.clearReviewSession();
        this.hideDialog();
        await this.loadWords();
        this.renderWordList();
        await this.alert('复习完成！');
      }
    };
    
    prevBtn.addEventListener('click', async () => {
      if (currentIndex > 0) {
        currentIndex--;
        await renderCurrentWord();
        prevBtn.disabled = currentIndex === 0;
      }
    });
    
    correctBtn.addEventListener('click', async () => {
      await handleReviewResult(true);
    });
    
    wrongBtn.addEventListener('click', async () => {
      await handleReviewResult(false);
    });
    
    const exitBtn = document.createElement('button');
    exitBtn.className = 'dialog-btn dialog-btn-secondary';
    exitBtn.textContent = '退出复习';
    exitBtn.addEventListener('click', async () => {
      this.hideDialog();
      // 退出时保存会话
      this.saveReviewSession(reviewWords, currentIndex);
      await this.loadWords();
      this.renderWordList();
      await this.alert('复习已保存，下次可以继续！');
    });
    
    dialogFooter.appendChild(exitBtn);
    dialogFooter.appendChild(prevBtn);
    dialogFooter.appendChild(wrongBtn);
    dialogFooter.appendChild(correctBtn);
    
    // 渲染当前单词
    renderCurrentWord();
    
    // 显示对话框
    document.getElementById('customDialog').classList.add('dialog-show');
    document.getElementById('dialogOverlay').classList.add('dialog-show');
    
    // 添加键盘导航
    const handleKeyDown = async (e) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        currentIndex--;
        await renderCurrentWord();
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = false;
      } else if (e.key === 'ArrowRight' && currentIndex < reviewWords.length - 1) {
        currentIndex++;
        await renderCurrentWord();
        prevBtn.disabled = false;
        nextBtn.disabled = currentIndex === reviewWords.length - 1;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    // 保存事件监听器，以便在关闭对话框时移除
    this.currentReviewKeydownListener = handleKeyDown;
  }
  
  // 隐藏自定义对话框（重写添加清理逻辑）
  hideDialog() {
    document.getElementById('customDialog').classList.remove('dialog-show');
    document.getElementById('dialogOverlay').classList.remove('dialog-show');
    
    // 移除键盘导航事件监听器
    if (this.currentReviewKeydownListener) {
      document.removeEventListener('keydown', this.currentReviewKeydownListener);
      this.currentReviewKeydownListener = null;
    }
    
    // 清理复习页面的Tooltip
    const tooltip = document.querySelector('.review-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
  }
  
  // 保存复习会话到localStorage
  saveReviewSession(reviewWords, currentIndex) {
    const session = {
      words: reviewWords,
      currentIndex,
      createdAt: Date.now()
    };
    localStorage.setItem('reviewSession', JSON.stringify(session));
  }
  
  // 从localStorage获取复习会话
  getReviewSession() {
    const sessionStr = localStorage.getItem('reviewSession');
    if (!sessionStr) return null;
    
    try {
      const session = JSON.parse(sessionStr);
      return session;
    } catch (error) {
      console.error('解析复习会话失败:', error);
      this.clearReviewSession();
      return null;
    }
  }
  
  // 清除复习会话
  clearReviewSession() {
    localStorage.removeItem('reviewSession');
  }
  
  // 检查会话是否有效（24小时内有效）
  isSessionValid(session) {
    if (!session) return false;
    const now = Date.now();
    const sessionTime = session.createdAt;
    const sessionAge = now - sessionTime;
    // 24小时内有效
    return sessionAge < 24 * 60 * 60 * 1000;
  }
  
  // 格式化时间差
  formatTimeDiff(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 60) {
      return `${minutes}分钟前`;
    } else if (hours < 24) {
      return `${hours}小时前`;
    } else {
      return `${days}天前`;
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