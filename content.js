// 转义正则特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 构建高效的多模式匹配正则（按长度降序排列，避免短单词优先匹配问题）
function buildMultiPatternRegex(wordList) {
  // 按长度降序排序，确保长词优先匹配
  const sortedWords = [...wordList].sort((a, b) => b.length - a.length);
  // 转义并分组
  const patterns = sortedWords.map(w => escapeRegExp(w));
  // 构建正则，使用捕获组保持匹配顺序
  const combinedPattern = patterns.map(p => `(${p})`).join('|');
  return new RegExp(combinedPattern, 'gi');
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
    this.init();
    this.initPageMarks(); // 新增初始化调用
  }

  // 新增方法：检测URL
  isUrl(text) {
    return /(?:https?:\/\/|www\.|^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})[\w\-\.\/?=&#%+]+/i.test(text);
  }

  init() {
    // 检查是否已标记，防止重复
    const markCheck = (text) => !this.isAlreadyMarked(text);
    
    // 单词计数器
    function countWords(text) {
      return text.split(/\s+/).filter(word => word.length > 0).length;
    }

    document.addEventListener('mouseup', (event) => {
      const selection = window.getSelection();
      const selectedText = selection.toString();
      
      // 跳过Ctrl键的选中（包括Ctrl+A）
      if (selectedText && !event.ctrlKey) {
        // 检查是否是全选(Ctrl+A)的情况
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // 如果选区包含整个body/document或是过大范围
        if (container === document.body || container === document.documentElement ||
            range.toString().length > 10000) {
          return;
        }
        
        // 新增：检查是否是URL
        if (this.isUrl(selectedText)) {
          return;
        }

        const trimmedText = selectedText.trim();
        if (!trimmedText) return;

        const wordCount = countWords(trimmedText);
        const wordLimit = CONFIG.WORD_COUNT_LIMIT || 50;
        if (wordCount > wordLimit) {
          chrome.runtime.sendMessage({
            type: 'show_notification',
            title: '单词数量限制',
            message: `一次最多只能选中${wordLimit}个单词`
          });
          return;
        }
        
        // 调整选区，排除前后空格
        const text = range.toString();
        const leadingSpaces = text.match(/^\s*/)[0].length;
        const trailingSpaces = text.match(/\s*$/)[0].length;
        
        // 创建新的范围，跳过前后空格
        const newRange = document.createRange();
        newRange.setStart(range.startContainer, range.startOffset + leadingSpaces);
        newRange.setEnd(range.endContainer, range.endOffset - trailingSpaces);
        
        // 更新选区
        selection.removeAllRanges();
        selection.addRange(newRange);
        
        if (markCheck(trimmedText)) {
          this.markWord(selection, trimmedText);
        }
      }
    });
  }

  // 新增方法：初始化页面标记（优化版）
  async initPageMarks() {
    const marks = await this.getMarks();
    if (!marks || Object.keys(marks).length === 0) return;

    const wordList = Object.values(marks).map(m => m.text);
    const regex = buildMultiPatternRegex(wordList);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      const parent = node.parentNode;
      if (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' || parent.nodeName === 'NOSCRIPT') {
        continue;
      }
      // 跳过已处理的节点
      if (parent.classList?.contains('word-mark')) continue;
      textNodes.push(node);
    }

    // 分批处理，每批处理 100 个节点，避免阻塞
    const BATCH_SIZE = 100;
    for (let i = 0; i < textNodes.length; i += BATCH_SIZE) {
      const batch = textNodes.slice(i, i + BATCH_SIZE);
      this.processTextNodesBatch(batch, regex, marks);
      // 让出主线程
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // 批量处理文本节点
  processTextNodesBatch(textNodes, regex, marks) {
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text || !text.trim()) continue;

      const matches = findAllMatches(text, regex);
      if (matches.length === 0) continue;

      // 按位置降序处理（从后往前替换，避免位置偏移）
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const mark = Object.values(marks).find(m => m.text.toLowerCase() === match.text.toLowerCase());
        if (mark) {
          this.markTextNode(textNode, match, mark);
        }
      }
    }
  }

  // 在文本节点中标记单个匹配
  markTextNode(textNode, match, markData) {
    const range = document.createRange();
    range.setStart(textNode, match.index);
    range.setEnd(textNode, match.index + match.length);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const markId = `mark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.createMarkElement(range, match.text, markData.translation, markId, range.cloneContents());
    this.markedWords.set(markId, {
      text: match.text,
      translation: markData.translation,
      originalContent: range.cloneContents()
    });
  }

  // 新增：获取所有标记
  async getMarks() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: 'get_marks'},
        (response) => resolve(response.marks)
      );
    });
  }

  isAlreadyMarked(text) {
    for (const [_, word] of this.markedWords) {
      if (word.text === text) return true;
    }
    return false;
  }

  async removeMark(markId) {
    const markData = this.markedWords.get(markId);
    if (!markData) return;

    // 从单词本中删除该单词
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'delete_word',
        word: markData.text
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('删除单词失败:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
    
    // 移除页面上所有相同的标记
    this.removeAllOccurrences(markData.text);
  }
  
  // 移除页面上所有相同的标记
  removeAllOccurrences(text) {
    // 获取所有相关的标记ID
    const markIdsToRemove = [];
    for (const [markId, markData] of this.markedWords) {
      if (markData.text === text) {
        markIdsToRemove.push(markId);
      }
    }
    
    // 移除DOM元素和存储
    markIdsToRemove.forEach(markId => {
      // 从Map中删除
      this.markedWords.delete(markId);
      
      // 发送消息更新标记存储
      chrome.runtime.sendMessage({
        type: 'remove_mark',
        markId
      });
      
      // 移除DOM元素
      const markElement = document.querySelector(`[data-mark-id="${markId}"]`);
      if (markElement) {
        const markData = this.markedWords.get(markId) || { text };
        const newTextNode = document.createTextNode(markData.text);
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
  }



  async markWord(selection, text) {
    // 先完成当前选区的标记
    const range = selection.getRangeAt(0);
    const markId = `mark_${Date.now()}`;
    const originalContent = range.cloneContents();
    
    const translation = await this.getTranslation(text);
    this.createMarkElement(range, text, translation, markId, originalContent);
    
    this.markedWords.set(markId, {
      text,
      translation,
      originalContent
    });
    this.saveMark({id: markId, text, translation});
    
    // 然后标记页面上所有相同的单词/词组
    this.markAllOccurrences(text, translation);
  }
  
  // 标记页面上所有相同的单词/词组
  markAllOccurrences(text, translation) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.parentNode.nodeName === 'SCRIPT' || node.parentNode.nodeName === 'STYLE' || node.parentNode.nodeName === 'NOSCRIPT') {
        continue;
      }
      
      // 跳过已标记的节点
      if (node.parentNode.classList?.contains('word-mark')) {
        continue;
      }
      
      const nodeText = node.nodeValue;
      const regex = new RegExp(escapeRegExp(text), 'gi');
      let match;
      
      // 重置正则状态
      regex.lastIndex = 0;
      while ((match = regex.exec(nodeText)) !== null) {
        // 创建范围标记
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
        
        // 避免无限循环（零长度匹配）
        if (regex.lastIndex === match.index) {
          regex.lastIndex++;
        }
      }
    }
  }

  createMarkElement(range, text, translation, id, originalContent) {
    const mark = document.createElement('span');
    mark.className = 'word-mark';
    mark.dataset.markId = id;
    const markColor = CONFIG.STYLES?.MARK_COLOR || '#1e90ff';
    const underlineWidth = CONFIG.STYLES?.MARK_UNDERLINE_WIDTH || '2px';
    mark.style.textDecoration = `underline ${markColor} ${underlineWidth}`;
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
    mark.addEventListener('mouseenter', () => {
      clearTimeout(hideTimeout);
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

    mark.appendChild(range.cloneContents());
    mark.appendChild(tooltip);
    range.deleteContents();
    range.insertNode(mark);
  }

  async getTranslation(text) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: 'translate', word: text},
        (response) => resolve(response.translation)
      );
    });
  }

  async saveMark(markData) {
    chrome.runtime.sendMessage({
      type: 'save_mark',
      markData
    });
  }
}

new WordMarker();