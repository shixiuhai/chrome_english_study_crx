// 转义正则特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 构建高效的多模式匹配正则（按长度降序排列，避免短单词优先匹配问题）
function buildMultiPatternRegex(wordList) {
  // 过滤掉无效单词，只保留非空且非纯空格的单词
  const filteredWords = wordList.filter(word => {
    return word && word.trim(); // 保留所有非空单词，包括长度为1的单词
  });
  
  // 按长度降序排序，确保长词优先匹配
  const sortedWords = [...filteredWords].sort((a, b) => b.length - a.length);
  
  // 去重，避免重复匹配
  const uniqueWords = [...new Set(sortedWords)];
  
  // 转义并使用捕获组，确保findAllMatches能正确获取匹配结果
  const patterns = uniqueWords.map(w => escapeRegExp(w));
  
  // 构建正则，使用捕获组
  const combinedPattern = patterns.map(p => `(${p})`).join('|');
  
  // 只有当有有效模式时才创建正则，否则返回空正则
  return combinedPattern ? new RegExp(combinedPattern, 'gi') : new RegExp('^$', 'gi');
}

// 查找所有匹配及其位置
function findAllMatches(text, regex) {
  const matches = [];
  let match;
  // 使用 lastIndex 重置正则状态
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    // 找出实际匹配的组索引
    for (let i = 1; i < match.length; i++) {
      if (match[i]) {
        matches.push({
          text: match[i],
          index: match.index,
          length: match[i].length
        });
        break;
      }
    }
    // 避免无限循环（零长度匹配）
    if (regex.lastIndex === match.index) {
      regex.lastIndex++;
    }
  }
  return matches;
}

class WordMarker {
  constructor() {
    this.markedWords = new Map();
    this.maxMarkedWords = window.CONFIG?.MAX_MARKED_WORDS || 1000;
    this.translationQueue = [];
    this.currentTranslations = 0;
    this.maxTranslations = 3;
    this.isContextValid = true;
    this.initPageMarksPromise = null;
    this.initPageMarksCompleted = false;
    this.pendingSelection = null;
    this.mutationObserver = null;
    this.remarkDebounceTimer = null;
    this.init();
    this.checkDomain().then(isAllowed => {
      if (this.isContextValid && isAllowed) {
        this.initPageMarksAsync();
        this.setupMutationObserver();
      }
    }).catch(error => {
      if (error.message.includes('Extension context invalidated')) {
        this.isContextValid = false;
        console.log('扩展上下文已销毁，跳过初始化');
      } else {
        console.error('初始化出错:', error);
      }
    });
  }

  // 检查当前域名是否被排除
  async checkDomain() {
    try {
      // 使用Promise版本的Chrome API，更好地处理错误
      const result = await chrome.storage.local.get([window.CONFIG?.STORAGE_KEYS?.EXCLUDED_DOMAINS || 'excluded_domains']);
      const excludedDomains = result[window.CONFIG?.STORAGE_KEYS?.EXCLUDED_DOMAINS || 'excluded_domains'] || [];
      const currentHostname = window.location.hostname;
      
      // 检查当前域名是否在排除列表中
      const isExcluded = excludedDomains.some(domain => {
        // 支持子域名排除 (如 *.example.com)
        if (domain.startsWith('*.')) {
          const baseDomain = domain.slice(2);
          return currentHostname === baseDomain || currentHostname.endsWith(`.${baseDomain}`);
        }
        // 精确匹配
        return currentHostname === domain;
      });
      
      if (isExcluded) {
        console.log('当前域名已被排除，插件功能已禁用');
        return false;
      } else {
        return true;
      }
    } catch (error) {
      // 处理扩展上下文被销毁的错误
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，跳过域名检查');
        return false;
      }
      // 其他错误
      console.error('检查域名时出错:', error);
      return true; // 默认允许，避免因错误导致功能失效
    }
  }

  // 设置DOM变化监听器，处理动态加载的内容
  setupMutationObserver() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    const observerOptions = {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    };

    this.mutationObserver = new MutationObserver((mutations) => {
      let hasNewContent = false;
      
      for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // 检查是否有新增的文本节点
            for (const node of mutation.addedNodes) {
              // 忽略纯文本节点（可能是删除标记后恢复的文本）
              if (node.nodeType === Node.TEXT_NODE) {
                continue;
              }
              
              // 检查是否是标记元素
              if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('word-mark')) {
                continue;
              }
              
              // 检查是否有实际的新内容
              if (node.nodeType === Node.ELEMENT_NODE && node.textContent) {
                hasNewContent = true;
                break;
              }
            }
          }
          if (hasNewContent) break;
        }

      if (hasNewContent) {
        // 使用防抖避免频繁重新标记
        if (this.remarkDebounceTimer) {
          clearTimeout(this.remarkDebounceTimer);
        }
        
        this.remarkDebounceTimer = setTimeout(() => {
          this.remarkExistingWords();
        }, 1000);
      }
    });

    // 开始监听整个文档
    this.mutationObserver.observe(document.body, observerOptions);
  }

  // 重新标记已有的单词（用于动态加载的内容）
  async remarkExistingWords() {
    try {
      const marks = await this.getMarks();
      if (!marks || Object.keys(marks).length === 0) {
        return;
      }

      const markValues = Object.values(marks);
      const wordList = markValues.map(m => m.text).filter(text => text && text.trim());
      if (wordList.length === 0) {
        return;
      }

      const regex = buildMultiPatternRegex(wordList);

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentNode;
            if (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' || 
                parent.nodeName === 'NOSCRIPT' || parent.classList?.contains('word-mark')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (!node.nodeValue || !node.nodeValue.trim()) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );

      const textNodes = [];
      let node;
      let nodeCount = 0;
      const MAX_NODES = 500;

      while ((node = walker.nextNode()) && nodeCount < MAX_NODES) {
        textNodes.push(node);
        nodeCount++;
      }

      const marksMap = {};
      markValues.forEach(mark => {
        marksMap[mark.text.toLowerCase()] = mark;
      });

      const BATCH_SIZE = 50;
      for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
        const batch = textNodes.slice(i, i + BATCH_SIZE);
        this.processTextNodesBatch(batch, regex, marksMap);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        this.isContextValid = false;
        console.log('扩展上下文已销毁，跳过重新标记');
      } else {
        console.error('重新标记时出错:', error);
      }
    }
  }

  // 新增方法：检测URL
  isUrl(text) {
    return /(?:https?:\/\/|www\.|^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})[\w\-\.\/?=&#%+]+/i.test(text);
  }

  // 新增方法：检测是否包含中文
  hasChinese(text) {
    // 正则表达式匹配中文汉字
    return /[\u4e00-\u9fa5]/.test(text);
  }

  init() {
    // 检查是否已标记，防止重复
    const markCheck = (text) => !this.isAlreadyMarked(text);
    
    // 单词计数器
    function countWords(text) {
      return text.split(/\s+/).filter(word => word.length > 0).length;
    }

    // 添加延迟确认定时器属性
    this.markTimeout = null;
    this.pendingMarkData = null;

    document.addEventListener('mouseup', (event) => {
      const selection = window.getSelection();
      const selectedText = selection.toString();
      
      if (this.markTimeout) {
        clearTimeout(this.markTimeout);
        this.markTimeout = null;
      }
      
      if (selectedText && !event.ctrlKey) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        if (container === document.body || container === document.documentElement ||
            range.toString().length > 10000) {
          return;
        }
        
        if (this.hasChinese(selectedText)) {
          return;
        }
        
        if (this.isUrl(selectedText)) {
          return;
        }

        const trimmedText = selectedText.trim();
        if (!trimmedText) return;

        const wordCount = countWords(trimmedText);
        if (wordCount > 50) {
          chrome.runtime.sendMessage({
            type: 'show_notification',
            title: '单词数量限制',
            message: '一次最多只能选中50个单词'
          });
          return;
        }
        
        const text = range.toString();
        const leadingSpaces = text.match(/^\s*/)[0].length;
        const trailingSpaces = text.match(/\s*$/)[0].length;
        
        let newStartOffset = range.startOffset + leadingSpaces;
        let newEndOffset = range.endOffset - trailingSpaces;
        
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newStartOffset = Math.min(newStartOffset, range.startContainer.length);
        }
        if (range.endContainer.nodeType === Node.TEXT_NODE) {
          newEndOffset = Math.min(newEndOffset, range.endContainer.length);
        }
        
        newStartOffset = Math.max(0, newStartOffset);
        newEndOffset = Math.max(0, newEndOffset);
        
        if (range.startContainer === range.endContainer) {
          newEndOffset = Math.max(newStartOffset, newEndOffset);
        }
        
        const newRange = document.createRange();
        try {
          newRange.setStart(range.startContainer, newStartOffset);
          newRange.setEnd(range.endContainer, newEndOffset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        } catch (e) {
          console.error('调整选区失败:', e);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        
        if (markCheck(trimmedText)) {
          this.pendingMarkData = {
            selection: window.getSelection(),
            text: trimmedText
          };
          
          this.markTimeout = setTimeout(() => {
            if (this.pendingMarkData) {
              this.markWord(this.pendingMarkData.selection, this.pendingMarkData.text);
              this.pendingMarkData = null;
            }
          }, 300);
        }
      } else if (event.ctrlKey && (event.key === 'a' || event.key === 'c')) {
        if (this.markTimeout) {
          clearTimeout(this.markTimeout);
          this.markTimeout = null;
        }
        if (this.pendingMarkData) {
          this.pendingMarkData = null;
        }
      }
    });
    
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.markTimeout) {
          clearTimeout(this.markTimeout);
          this.markTimeout = null;
        }
        if (this.pendingMarkData) {
          this.pendingMarkData = null;
        }
      }
      
      if (event.ctrlKey && (event.key === 'a' || event.key === 'c')) {
        if (this.markTimeout) {
          clearTimeout(this.markTimeout);
          this.markTimeout = null;
        }
        if (this.pendingMarkData) {
          this.pendingMarkData = null;
        }
      }
    });

    document.addEventListener('copy', (event) => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (this.markTimeout) {
        clearTimeout(this.markTimeout);
        this.markTimeout = null;
      }
      if (this.pendingMarkData) {
        this.pendingMarkData = null;
      }
      
      if (selectedText) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        let parentElement = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
        
        let foundMarkElement = null;
        
        let current = parentElement;
        while (current && current !== document.body) {
          if (current.classList && current.classList.contains('word-mark')) {
            foundMarkElement = current;
            break;
          }
          current = current.parentNode;
        }
        
        if (foundMarkElement) {
          const markId = foundMarkElement.dataset.markId;
          if (markId) {
            this.removeMark(markId);
          }
        } else {
          const trimmedText = selectedText.trim();
          for (const [id, data] of this.markedWords.entries()) {
            if (data.text === trimmedText) {
              this.removeAllMarksForWord(trimmedText);
              break;
            }
          }
        }
      }
    });
  }

  // 新增方法：异步初始化页面标记（优化版）
  async initPageMarksAsync() {
    if (this.initPageMarksPromise) {
      return this.initPageMarksPromise;
    }

    this.initPageMarksPromise = (async () => {
      try {
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve, { once: true });
          }
        });

        // 增加初始延迟，等待动态内容加载
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 多次尝试初始化，确保动态内容也被标记
        const maxRetries = 3;
        for (let retry = 0; retry < maxRetries; retry++) {
          await this.doInitPageMarks();
          
          // 如果不是最后一次重试，等待一段时间再尝试
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        this.initPageMarksCompleted = true;
      } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
          this.isContextValid = false;
          console.log('扩展上下文已销毁，跳过页面标记初始化');
        } else {
          console.error('初始化页面标记时出错:', error);
        }
        this.initPageMarksCompleted = true;
      }
    })();

    return this.initPageMarksPromise;
  }

  // 执行实际的页面标记初始化
  async doInitPageMarks() {
    const marks = await this.getMarks();
    if (!marks || Object.keys(marks).length === 0) {
      return;
    }

    const markValues = Object.values(marks);
    const wordList = markValues.map(m => m.text).filter(text => text && text.trim());
    if (wordList.length === 0) {
      return;
    }

    const regex = buildMultiPatternRegex(wordList);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentNode;
          if (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' || 
              parent.nodeName === 'NOSCRIPT' || parent.classList?.contains('word-mark')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const textNodes = [];
    let node;
    let nodeCount = 0;
    const MAX_NODES = 500;

    while ((node = walker.nextNode()) && nodeCount < MAX_NODES) {
      textNodes.push(node);
      nodeCount++;
    }

    const marksMap = {};
    markValues.forEach(mark => {
      marksMap[mark.text.toLowerCase()] = mark;
    });

    const BATCH_SIZE = 50;
    for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
      const batch = textNodes.slice(i, i + BATCH_SIZE);
      this.processTextNodesBatch(batch, regex, marksMap);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // 批量处理文本节点
  processTextNodesBatch(textNodes, regex, marksMap) {
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text || !text.trim()) continue;

      const matches = findAllMatches(text, regex);
      if (matches.length === 0) continue;

      // 按位置降序处理（从后往前替换，避免位置偏移）
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        // 使用映射查找，提高性能
        const mark = marksMap[match.text.toLowerCase()];
        if (mark) {
          this.markTextNode(textNode, match, mark);
        }
      }
    }
  }

  // 在文本节点中标记单个匹配
  markTextNode(textNode, match, markData) {
    try {
      // 检查文本节点是否仍在文档中
      if (!document.contains(textNode)) {
        return;
      }
      
      // 检查文本节点内容是否已更改
      const currentText = textNode.nodeValue;
      if (!currentText || currentText.length < match.index + match.length) {
        return;
      }
      
      // 检查该位置是否已经被标记
      const parent = textNode.parentNode;
      if (parent && parent.classList && parent.classList.contains('word-mark')) {
        return;
      }
      
      // 检查文本节点是否在已标记的元素内
      let current = textNode.parentNode;
      while (current && current !== document.body) {
        if (current.classList && current.classList.contains('word-mark')) {
          return;
        }
        current = current.parentNode;
      }
      
      const range = document.createRange();
      
      // 验证range参数有效性
      const validStartIndex = Math.max(0, Math.min(match.index, currentText.length));
      const validEndIndex = Math.min(match.index + match.length, currentText.length);
      
      if (validStartIndex >= validEndIndex) {
        return;
      }
      
      range.setStart(textNode, validStartIndex);
      range.setEnd(textNode, validEndIndex);

      // 检查range是否在文档中
      let isRangeInDocument = false;
      try {
        isRangeInDocument = document.contains(range.commonAncestorContainer);
      } catch (e) {
        console.error('检查range是否在文档中失败:', e);
      }
      
      if (!isRangeInDocument) {
        return;
      }

      const markId = `mark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.createMarkElement(range, match.text, markData.translation, markId, range.cloneContents());
      this.markedWords.set(markId, {
        text: match.text,
        translation: markData.translation,
        originalContent: range.cloneContents()
      });
    } catch (e) {
      console.error('标记文本节点失败:', e);
    }
  }

  // 新增：获取所有标记
  async getMarks() {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'get_marks'},
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            resolve(response.marks);
          }
        );
      });
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，跳过获取标记');
        return {};
      }
      console.error('获取标记时出错:', error);
      return {};
    }
  }

  isAlreadyMarked(text) {
    for (const [_, word] of this.markedWords) {
      if (word.text === text) return true;
    }
    return false;
  }

  // 移除单词本中的单词
  async removeWordFromDictionary(word) {
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'delete_word',
          word
        }, () => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('从单词本删除单词失败:', error);
      // 只记录错误，不抛出，避免影响用户体验
    }
  }
  
  // 移除所有相同单词的标记
  async removeAllMarksForWord(word) {
    try {
      // 1. 暂时断开 MutationObserver，避免重新标记
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }
      
      // 2. 从单词本中删除该单词
      await this.removeWordFromDictionary(word);
      
      // 3. 收集所有需要删除的标记ID（从Map中）
      const markIdsToRemove = [];
      for (const [id, data] of this.markedWords.entries()) {
        if (data.text === word) {
          markIdsToRemove.push(id);
        }
      }
      
      // 4. 从DOM中查找所有包含该单词的标记元素（包括未在Map中的）
      const allMarkElements = document.querySelectorAll('.word-mark');
      allMarkElements.forEach(markElement => {
        const markId = markElement.dataset.markId;
        const textContent = markElement.textContent.trim();
        
        // 如果元素包含该单词且ID不在已收集列表中，添加到列表
        if (textContent === word && !markIdsToRemove.includes(markId)) {
          markIdsToRemove.push(markId);
        }
      });
      
      // 5. 从Map中删除所有相关标记
      markIdsToRemove.forEach(id => {
        this.markedWords.delete(id);
      });
      
      // 6. 从DOM中移除所有相关标记
      markIdsToRemove.forEach(id => {
        const markElement = document.querySelector(`[data-mark-id="${id}"]`);
        if (markElement) {
          // 直接恢复文本
          const newTextNode = document.createTextNode(word);
          markElement.replaceWith(newTextNode);
          
          // 添加轻微动画效果
          if (newTextNode && newTextNode.style) {
            newTextNode.style.opacity = '0';
            newTextNode.style.transition = 'opacity 0.3s';
            const animate = () => {
              if (newTextNode && newTextNode.style) {
                newTextNode.style.opacity = '1';
              }
            };
            requestAnimationFrame(() => {
              requestAnimationFrame(animate);
            });
          }
        }
      });
      
      // 7. 通知background移除所有相关标记
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'remove_all_marks_for_word',
            word
          }, (response) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            resolve(response);
          });
        });
      } catch (error) {
        if (!error.message.includes('Extension context invalidated')) {
          console.error('移除所有标记通知失败:', error);
        }
      }
      
      // 8. 重新连接 MutationObserver（等待DOM操作完成）
      setTimeout(() => {
        if (this.mutationObserver) {
          this.setupMutationObserver();
        }
      }, 500);
      
    } catch (error) {
      console.error('移除所有标记失败:', error);
      // 扩展上下文被销毁时的处理
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，跳过删除标记');
        // 仍然尝试清理DOM
        const wordToRemove = word;
        
        // 从DOM中查找所有包含该单词的标记元素
        const allMarkElements = document.querySelectorAll('.word-mark');
        allMarkElements.forEach(markElement => {
          const textContent = markElement.textContent.trim();
          
          if (textContent === wordToRemove) {
            const newTextNode = document.createTextNode(wordToRemove);
            markElement.replaceWith(newTextNode);
            
            // 从Map中删除
            const markId = markElement.dataset.markId;
            if (markId) {
              this.markedWords.delete(markId);
            }
          }
        });
      }
      
      // 确保重新连接 MutationObserver
      setTimeout(() => {
        if (this.mutationObserver) {
          this.setupMutationObserver();
        }
      }, 1500);
    }
  }
  
  async removeMark(markId) {
    const markData = this.markedWords.get(markId);
    if (!markData) {
      // 如果Map中没有找到标记数据，尝试从DOM中获取
      const markElement = document.querySelector(`[data-mark-id="${markId}"]`);
      if (markElement) {
        const word = markElement.textContent.trim();
        await this.removeAllMarksForWord(word);
      }
      return;
    }

    try {
      // 移除所有相同单词的标记
      await this.removeAllMarksForWord(markData.text);
    } catch (error) {
      console.error('删除标记时出错:', error);
      // 扩展上下文被销毁时的处理
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，跳过删除标记');
        // 仍然尝试清理DOM和Map
        const wordToRemove = markData.text;
        
        // 暂时断开 MutationObserver
        if (this.mutationObserver) {
          this.mutationObserver.disconnect();
        }
        
        // 从DOM中查找所有包含该单词的标记元素
        const allMarkElements = document.querySelectorAll('.word-mark');
        allMarkElements.forEach(markElement => {
          const textContent = markElement.textContent.trim();
          
          if (textContent === wordToRemove) {
            const newTextNode = document.createTextNode(wordToRemove);
            markElement.replaceWith(newTextNode);
            
            // 从Map中删除
            const elementMarkId = markElement.dataset.markId;
            if (elementMarkId) {
              this.markedWords.delete(elementMarkId);
            }
          }
        });
        
        // 重新连接 MutationObserver（等待DOM操作完成）
        setTimeout(() => {
          if (this.mutationObserver) {
            this.setupMutationObserver();
          }
        }, 500);
      }
    }
  }



  async markWord(selection, text) {
    // 检查扩展上下文是否有效
    if (!this.isContextValid) {
      console.log('扩展上下文已销毁，跳过标记单词');
      return;
    }
    
    // 检查文本是否包含中文，防止添加中文到英文单词表
    if (this.hasChinese(text)) {
      console.log('检测到中文，跳过标记单词:', text);
      return;
    }
    
    // 检查当前域名是否被排除
    const isAllowed = await this.checkDomain();
    if (!isAllowed) {
      return;
    }
    
    // 1. 先获取选区范围
    const range = selection.getRangeAt(0);
    
    // 2. 先生成唯一ID
    const markId = `mark_${Date.now()}`;
    const originalContent = range.cloneContents();
    
    // 3. 创建临时翻译，先划线
    const tempTranslation = '正在翻译...';
    
    // 4. 立即创建当前选区的标记，提升用户体验
    this.createMarkElement(range, text, tempTranslation, markId, originalContent);
    
    // 5. 保存到Map
    this.markedWords.set(markId, {
      text,
      translation: tempTranslation,
      originalContent
    });
    
    // 6. 将翻译请求添加到队列
    const translationRequest = {
      markId,
      text
    };
    
    // 检查当前翻译数量
    if (this.currentTranslations >= this.maxTranslations) {
      // 添加到队列
      this.translationQueue.push(translationRequest);
      // 更新标记显示
      this.updateMarkTranslation(markId, '等待翻译中...');
    } else {
      // 立即处理
      this.processTranslation(translationRequest);
    }
  }
  
  // 处理单个翻译请求
  processTranslation(request) {
    // 检查扩展上下文是否有效
    if (!this.isContextValid) {
      console.log('扩展上下文已销毁，跳过翻译请求');
      this.processTranslationQueue();
      return;
    }
    
    this.currentTranslations++;
    
    // 添加翻译超时处理，防止长时间等待导致页面卡死
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Translation timeout')), 10000); // 10秒超时
    });
    
    Promise.race([this.getTranslation(request.text), timeoutPromise])
      .then(translation => {
        // 再次检查扩展上下文是否有效
        if (!this.isContextValid) {
          console.log('扩展上下文已销毁，跳过翻译结果处理');
          return;
        }
        
        // 更新当前标记的翻译
        this.updateMarkTranslation(request.markId, translation);
        
        // 保存到存储
        this.saveMark({id: request.markId, text: request.text, translation});
        
        // 标记页面上所有其他相同的单词/词组（限制处理频率）
        requestAnimationFrame(() => {
          this.markOtherOccurrences(request.text, translation);
        });
      })
      .catch(error => {
        console.error('翻译处理失败:', error);
        // 确保UI更新，避免一直显示“正在翻译”
        if (this.isContextValid) {
          this.updateMarkTranslation(request.markId, `${request.text}的翻译`);
        }
      })
      .finally(() => {
        // 翻译完成，减少计数（确保不出现负数）
        this.currentTranslations = Math.max(0, this.currentTranslations - 1);
        // 处理队列中的下一个请求
        this.processTranslationQueue();
      });
  }
  
  // 处理翻译队列
  processTranslationQueue() {
    if (this.translationQueue.length > 0 && this.currentTranslations < this.maxTranslations) {
      const nextRequest = this.translationQueue.shift();
      // 更新标记显示
      this.updateMarkTranslation(nextRequest.markId, '正在翻译...');
      // 处理请求
      this.processTranslation(nextRequest);
    }
  }
  
  // 更新单个标记的翻译
  updateMarkTranslation(markId, translation) {
    // 更新Map中的数据
    const markData = this.markedWords.get(markId);
    if (markData) {
      markData.translation = translation;
      this.markedWords.set(markId, markData);
    }
    
    // 更新DOM显示
    const markElement = document.querySelector(`[data-mark-id="${markId}"]`);
    if (markElement) {
      const tooltip = markElement.querySelector('.word-tooltip');
      if (tooltip) {
        const translationSpan = tooltip.querySelector('.translation-highlight');
        if (translationSpan) {
          translationSpan.textContent = translation;
        }
      }
    }
  }
  
  // 标记页面上其他相同的单词/词组（优化版）
  markOtherOccurrences(text, translation) {
    requestAnimationFrame(() => {
      const maxOccurrences = 3;
      let occurrencesMarked = 0;
      const maxNodesToProcess = 30;
      let nodesProcessed = 0;
      
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentNode;
            if (parent.nodeName === 'SCRIPT' || 
                parent.nodeName === 'STYLE' || 
                parent.nodeName === 'NOSCRIPT' ||
                parent.classList?.contains('word-mark')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (!node.nodeValue || !node.nodeValue.includes(text)) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );
      
      let node;
      while ((node = walker.nextNode()) && nodesProcessed < maxNodesToProcess && occurrencesMarked < maxOccurrences) {
        nodesProcessed++;
        
        const nodeText = node.nodeValue;
        const matches = [];
        const regex = new RegExp(escapeRegExp(text), 'gi');
        let match;
        
        regex.lastIndex = 0;
        while ((match = regex.exec(nodeText)) !== null && occurrencesMarked < maxOccurrences) {
          if (match.index + text.length <= nodeText.length) {
            matches.push({...match});
            occurrencesMarked++;
          }
          
          if (regex.lastIndex === match.index) {
            regex.lastIndex++;
          }
        }
        
        matches.sort((a, b) => b.index - a.index);
        
        for (const match of matches) {
          try {
            if (!node.parentNode) {
              continue;
            }
            
            if (match.index < 0 || match.index + text.length > node.nodeValue.length) {
              continue;
            }
            
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + text.length);
            
            const markId = `mark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const originalContent = range.cloneContents();
            
            this.createMarkElement(range, text, translation, markId, originalContent);
            this.markedWords.set(markId, {
              text,
              translation,
              originalContent
            });
            this.saveMark({id: markId, text, translation});
          } catch (error) {
            console.warn('标记单词时出错:', error.message);
            continue;
          }
        }
      }
    });
  }

  createMarkElement(range, text, translation, id, originalContent) {
    const mark = document.createElement('span');
    mark.className = 'word-mark';
    mark.dataset.markId = id;
    mark.style.textDecoration = 'underline #1e90ff 2px';
    mark.style.position = 'relative';
    mark.style.cursor = 'pointer';

    // 添加点击事件
    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeMark(id);
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'word-tooltip';
    const translationSpan = document.createElement('span');
    translationSpan.className = 'translation-highlight';
    translationSpan.textContent = translation;
    tooltip.appendChild(translationSpan);

    // 改进的悬浮窗显示控制
    let hideTimeout;
    mark.addEventListener('mouseenter', (e) => {
      clearTimeout(hideTimeout);
      
      // 计算tooltip的位置（固定定位需要重新计算）
      const rect = mark.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      
      // 计算基本位置
      let left = rect.left + rect.width / 2;
      let top = rect.bottom + 8;
      
      // 确保tooltip不会超出视口
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // 调整水平位置，避免超出视口
      if (left - tooltipRect.width / 2 < 0) {
        left = tooltipRect.width / 2 + 10;
      } else if (left + tooltipRect.width / 2 > viewportWidth) {
        left = viewportWidth - tooltipRect.width / 2 - 10;
      }
      
      // 调整垂直位置，避免超出视口
      if (top + tooltipRect.height > viewportHeight) {
        top = rect.top - tooltipRect.height - 8;
      }
      
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.transform = 'translateX(-50%)';
      
      tooltip.style.display = 'block';
    });
    
    mark.addEventListener('mouseleave', () => {
      hideTimeout = setTimeout(() => {
        if (!tooltip.matches(':hover')) {
          tooltip.style.display = 'none';
        }
      }, 300);
    });

    // 监听tooltip的鼠标事件
    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(hideTimeout);
    });

    tooltip.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });

    // 使用纯文本节点，确保只显示核心文本
    const textNode = document.createTextNode(text);
    mark.appendChild(textNode);
    mark.appendChild(tooltip);
    range.deleteContents();
    range.insertNode(mark);
  }

  async getTranslation(text) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'translate', word: text},
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            resolve(response.translation);
          }
        );
      });
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.log('扩展上下文已销毁，返回默认翻译');
        return `${text}的翻译`;
      }
      console.error('获取翻译时出错:', error);
      return `${text}的翻译`;
    }
  }

  async saveMark(markData) {
    try {
      chrome.runtime.sendMessage({
        type: 'save_mark',
        markData
      });
    } catch (error) {
      if (!error.message.includes('Extension context invalidated')) {
        console.error('保存标记时出错:', error);
      }
    }
  }
}

new WordMarker();