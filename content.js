// 转义正则特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      const text = selection.toString().trim();
      
      // 跳过Ctrl键的选中（包括Ctrl+A）
      if (text && !event.ctrlKey) {
        // 检查是否是全选(Ctrl+A)的情况
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // 如果选区包含整个body/document或是过大范围
        if (container === document.body || container === document.documentElement ||
            range.toString().length > 10000) {
          return;
        }
        
        // 新增：检查是否是URL
        if (this.isUrl(text)) {
          return;
        }

        const wordCount = countWords(text);
        if (wordCount > 50) {
          chrome.runtime.sendMessage({
            type: 'show_notification',
            title: '单词数量限制',
            message: '一次最多只能选中50个单词'
          });
          return;
        }
        if (markCheck(text)) {
          this.markWord(selection, text);
        }
      }
    });
  }

  // 新增方法：初始化页面标记
  async initPageMarks() {
    const marks = await this.getMarks();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.parentNode.nodeName === 'SCRIPT' || node.parentNode.nodeName === 'STYLE') {
        continue;
      }

      Object.values(marks).forEach((mark) => {
        const regex = new RegExp(escapeRegExp(mark.text), 'gi');
        if (regex.test(node.nodeValue)) {
          this.markExistingWord(node, mark);
        }
      });
    }
  }

  // 辅助方法：标记已存在的单词
  async markExistingWord(textNode, markData) {
    const range = document.createRange();
    const index = textNode.nodeValue.indexOf(markData.text);
    
    if (index >= 0) {
      range.setStart(textNode, index);
      range.setEnd(textNode, index + markData.text.length);
      
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      
      await this.markWord(selection, markData.text);
    }
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

    // 先删除单词本中的单词
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
    
    // 从Map中删除
    this.markedWords.delete(markId);
    
    // 发送消息更新标记存储
    chrome.runtime.sendMessage({
      type: 'remove_mark',
      markId
    });
    
    // 找到并移除DOM元素
    const markElement = document.querySelector(`[data-mark-id="${markId}"]`);
    if (markElement) {
      // 创建新的文本节点恢复原始内容
      const newTextNode = document.createTextNode(markData.text);
      markElement.replaceWith(newTextNode);
      
      // 添加轻微动画效果
      newTextNode.style.opacity = '0';
      newTextNode.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        newTextNode.style.opacity = '1';
      }, 10);
    }
  }

  async markWord(selection, text) {
    const range = selection.getRangeAt(0);
    const markId = `mark_${Date.now()}`;
    // 克隆原始内容节点
    const originalContent = range.cloneContents();
    
    const translation = await this.getTranslation(text);
    this.createMarkElement(range, text, translation, markId, originalContent);
    
    this.markedWords.set(markId, {text, translation, originalContent});
    this.saveMark({id: markId, text, translation});
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