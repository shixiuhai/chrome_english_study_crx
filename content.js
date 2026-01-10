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
    this.translationQueue = [];
    this.currentTranslations = 0;
    this.maxTranslations = 5; // 最大同时翻译数量
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
        if (wordCount > 50) {
          chrome.runtime.sendMessage({
            type: 'show_notification',
            title: '单词数量限制',
            message: '一次最多只能选中50个单词'
          });
          return;
        }
        
        // 调整选区，排除前后空格
        const text = range.toString();
        const leadingSpaces = text.match(/^\s*/)[0].length;
        const trailingSpaces = text.match(/\s*$/)[0].length;
        
        // 创建新的范围，跳过前后空格
        const newRange = document.createRange();
        
        // 验证startOffset有效性
        const startOffset = range.startOffset + leadingSpaces;
        const startContainerLength = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.length : 0;
        
        // 验证endOffset有效性
        const endOffset = range.endOffset - trailingSpaces;
        const endContainerLength = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.length : 0;
        
        // 确保offset值有效，避免IndexSizeError
        const validStartOffset = Math.max(0, Math.min(startOffset, startContainerLength));
        let validEndOffset = Math.max(0, endOffset);
        
        // 如果是同一容器，确保endOffset不小于startOffset
        if (range.startContainer === range.endContainer) {
          validEndOffset = Math.max(validStartOffset, Math.min(validEndOffset, endContainerLength));
        } else {
          validEndOffset = Math.min(validEndOffset, endContainerLength);
        }
        
        try {
          newRange.setStart(range.startContainer, validStartOffset);
          newRange.setEnd(range.endContainer, validEndOffset);
          
          // 更新选区
          selection.removeAllRanges();
          selection.addRange(newRange);
        } catch (e) {
          console.error('调整选区失败:', e);
          // 失败时使用原始选区
          selection.removeAllRanges();
          selection.addRange(range);
        }
        
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
    
    this.markedWords.delete(markId);
    
    chrome.runtime.sendMessage({
      type: 'remove_mark',
      markId
    });
    
    const markElement = document.querySelector(`[data-mark-id="${markId}"]`);
    if (markElement) {
      // 直接恢复文本，不需要处理空格，因为我们在选区时已经排除了空格
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
  }



  async markWord(selection, text) {
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
    this.currentTranslations++;
    
    this.getTranslation(request.text).then(translation => {
      // 更新当前标记的翻译
      this.updateMarkTranslation(request.markId, translation);
      
      // 保存到存储
      this.saveMark({id: request.markId, text: request.text, translation});
      
      // 标记页面上所有其他相同的单词/词组
      this.markOtherOccurrences(request.text, translation);
    }).finally(() => {
      // 翻译完成，减少计数
      this.currentTranslations--;
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
  
  // 标记页面上其他相同的单词/词组
  markOtherOccurrences(text, translation) {
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
      const matches = [];
      const regex = new RegExp(escapeRegExp(text), 'gi');
      let match;
      
      // 1. 先收集所有匹配，不修改DOM
      regex.lastIndex = 0;
      while ((match = regex.exec(nodeText)) !== null) {
        // 检查匹配是否有效
        if (match.index + text.length <= nodeText.length) {
          matches.push({...match});
        }
        
        // 避免无限循环（零长度匹配）
        if (regex.lastIndex === match.index) {
          regex.lastIndex++;
        }
      }
      
      // 2. 按位置降序处理匹配（从后往前），避免DOM修改影响后续匹配
      matches.sort((a, b) => b.index - a.index);
      
      // 3. 遍历处理所有匹配
      for (const match of matches) {
        try {
          // 再次检查节点是否仍然有效
          if (!node.parentNode || node.nodeValue !== nodeText) {
            break;
          }
          
          // 检查索引是否有效
          if (match.index < 0 || match.index + text.length > node.nodeValue.length) {
            continue;
          }
          
          // 创建范围标记
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + text.length);
          
          const markId = `mark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const originalContent = range.cloneContents();
          
          // 直接使用翻译结果创建标记
          this.createMarkElement(range, text, translation, markId, originalContent);
          this.markedWords.set(markId, {
            text,
            translation,
            originalContent
          });
          this.saveMark({id: markId, text, translation});
        } catch (error) {
          console.warn('标记单词时出错:', error.message);
          // 跳过错误，继续处理其他匹配
          continue;
        }
      }
    }
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