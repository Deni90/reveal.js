
import { basicSetup } from 'codemirror';

import {
  EditorState,
  StateEffect,
  StateField
} from '@codemirror/state';

import {
  EditorView,
  Decoration
} from '@codemirror/view';

import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

// Line highlighting
const setHighlightedLines = StateEffect.define();

const lineDecorations = StateField.define({
  create() {
    return Decoration.none;
  },

  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (!effect.is(setHighlightedLines)) continue;

      const activeLines = new Set(effect.value);
      const ranges = [];

      if (activeLines.size > 0) {
        for (
          let number = 1;
          number <= transaction.state.doc.lines;
          number++
        ) {
          const line = transaction.state.doc.line(number);

          ranges.push(
            Decoration.line({
              attributes: {
                class: activeLines.has(number)
                  ? 'presentation-highlight'
                  : 'presentation-dimmed'
              }
            }).range(line.from)
          );
        }
      }

      decorations = ranges.length
        ? Decoration.set(ranges, true)
        : Decoration.none;
    }

    return decorations;
  },

  provide: field =>
    EditorView.decorations.from(field)
});

// Parse data-line-numbers
//
// Example:
// data-line-numbers="1|3-5|7|9-11"
//
// Each pipe-separated group represents one presentation step.
// Commas can select multiple lines within a step.
function parseLineSteps(value = '') {
  if (!value.trim()) return [];

  return value.split('|').map(group => {
    const lines = new Set();

    for (const part of group.split(',')) {
      const token = part.trim();

      if (!token) continue;

      const range = token.match(/^(\d+)\s*-\s*(\d+)$/);

      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);

        for (
          let number = Math.min(start, end);
          number <= Math.max(start, end);
          number++
        ) {
          if (number > 0) lines.add(number);
        }
      } else if (/^\d+$/.test(token)) {
        const number = Number(token);

        if (number > 0) lines.add(number);
      }
    }

    return [...lines].sort((a, b) => a - b);
  });
}

// Language detection
function getLanguageExtension(code) {
  const language =
    code.dataset.language ||
    [...code.classList]
      .map(name => name.match(/^language-(.+)$/)?.[1])
      .find(Boolean) ||
    '';

  switch (language.toLowerCase()) {
    case 'cpp':
    case 'c++':
    case 'c':
      return cpp();

    case 'javascript':
    case 'js':
    case 'typescript':
    case 'ts':
      return javascript();

    case 'python':
    case 'py':
      return python();

    default:
      return [];
  }
}

// Plugin
const CodeEditor = () => {
  const editors = new Map();
  const sourceElements = new Map();

  let deck = null;
  let idCounter = 0;

  // Public source-provider adapter
  //
  // The runner calls getSource(id), without needing to know
  // anything about CodeMirror or editor lifecycle.
  const sourceProvider = {
    getSource(id) {
      const state = editors.get(id);

      if (state) {
        return state.view.state.doc.toString();
      }

      // When an editor is unmounted, its latest contents are
      // copied back into the original code element.
      const code = sourceElements.get(id);

      if (code) {
        return code.textContent ?? '';
      }

      return null;
    }
  };

  // Ensure every source block has an ID
  function ensureCodeId(code) {
    if (code.id) return code.id;

    let id;

    do {
      id = `reveal-code-${++idCounter}`;
    } while (document.getElementById(id));

    code.id = id;

    return id;
  }

  // Highlight and scroll to the active presentation step
  function refreshHighlight(state, forceScroll = false) {
    const { view, steps, fragments } = state;

    if (!view || view.state.doc.lines === 0) return;

    let activeStep = -1;

    // Reveal fragments remain visible after they are shown.
    // The last visible fragment determines the current step.
    for (let index = 0; index < fragments.length; index++) {
      if (fragments[index].classList.contains('visible')) {
        activeStep = index;
      }
    }

    // The first line group is active before the first advance.
    if (activeStep < 0) activeStep = 0;

    activeStep = Math.min(activeStep, steps.length - 1);

    const lines = (steps[activeStep] ?? []).filter(
      number => number <= view.state.doc.lines
    );

    view.dispatch({
      effects: setHighlightedLines.of(lines)
    });

    if (
      lines.length > 0 &&
      (forceScroll || activeStep !== state.lastActiveStep)
    ) {
      const line = view.state.doc.line(lines[0]);

      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, {
          y: 'center',
          x: 'nearest',
          yMargin: 30
        })
      });
    }

    state.lastActiveStep = activeStep;
  }

  function getInitialSource(code) {
    return (code.textContent ?? '').replace(/^\n|\n\s*$/g, '');
  }

  // Create a CodeMirror editor for one code block
  function mountCode(code, slide) {
    if (!code || !code.closest('pre')) return;
    if (code.dataset.codeEditorMounted === 'true') return;

    const pre = code.closest('pre');
    const id = ensureCodeId(code);

    // Avoid mounting a second editor for an existing ID.
    if (editors.has(id)) return;

    const steps = parseLineSteps(
      code.getAttribute('data-line-numbers') ?? ''
    );

    const host = document.createElement('div');
    host.className = 'cm-presentation';

    const isEditable =
      code.getAttribute('contenteditable') === 'true';

    const extensions = [
      basicSetup,
      getLanguageExtension(code),
      lineDecorations,

      // Read-only unless contenteditable="true".
      EditorState.readOnly.of(!isEditable),
      EditorView.editable.of(isEditable),

      EditorView.contentAttributes.of({
        'aria-label': 'Source code editor'
      })
    ];

    if (Array.isArray(oneDark)) {
      extensions.push(...oneDark);
    } else {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: getInitialSource(code),
      extensions
    });

    const view = new EditorView({
      state,
      parent: host
    });

    // One invisible Reveal fragment per line group.
    const fragments = steps.map((_, index) => {
      const fragment = document.createElement('span');

      fragment.className =
        index === 0
          ? 'fragment visible cm-line-step'
          : 'fragment cm-line-step';

      fragment.setAttribute('aria-hidden', 'true');
      fragment.dataset.lineStep = String(index);

      return fragment;
    });

    const editorState = {
      id,
      code,
      pre,
      host,
      view,
      slide,
      steps,
      fragments,
      lastActiveStep: -1
    };

    // Save the original source element so it remains available
    // even while its <pre> is replaced by CodeMirror.
    sourceElements.set(id, code);

    // Replace the original <pre> with the editor.
    pre.replaceWith(host);

    if (fragments.length > 0) {
      host.after(...fragments);
    }

    code.dataset.codeEditorMounted = 'true';

    editors.set(id, editorState);

    refreshHighlight(editorState, true);
  }


  // Mount all code blocks on the active slide
  function mountSlide(slide) {
    if (!slide) return;

    const codeBlocks = slide.querySelectorAll('pre code');

    for (const code of codeBlocks) {
      mountCode(code, slide);
    }

    // Tell Reveal to discover the new line-step fragments.
    if (deck && codeBlocks.length > 0) {
      deck.sync();
    }

    // Re-evaluate fragment visibility after Reveal syncs.
    refreshAllHighlights(true);
  }

  // Destroy an editor and restore its original <pre>
  function unmountCode(state) {
    const {
      id,
      code,
      pre,
      host,
      view,
      fragments
    } = state;

    // Preserve edits before removing CodeMirror.
    code.textContent = view.state.doc.toString();

    view.destroy();

    for (const fragment of fragments) {
      fragment.remove();
    }

    code.dataset.codeEditorMounted = 'false';

    if (host.isConnected) {
      host.replaceWith(pre);
    }

    editors.delete(id);
  }

  // Unmount all editors belonging to a slide
  function unmountSlide(slide) {
    if (!slide) return;

    for (const state of [...editors.values()]) {
      if (state.slide === slide) {
        unmountCode(state);
      }
    }

    if (deck) {
      deck.sync();
    }
  }

  // Unmount every active editor
  function unmountAll() {
    for (const state of [...editors.values()]) {
      unmountCode(state);
    }

    if (deck) {
      deck.sync();
    }
  }

  // Update highlighting after fragment navigation
  function refreshAllHighlights(forceScroll = false) {
    for (const state of editors.values()) {
      refreshHighlight(state, forceScroll);
    }
  }

  // Reveal.js event handlers

  function onReady(event) {
    mountSlide(event.currentSlide ?? deck.getCurrentSlide());
  }

  function onSlideChanged(event) {
    unmountAll();
    mountSlide(event.currentSlide);
  }

  function onFragmentChanged() {
    refreshAllHighlights(true);
  }


  // Public Reveal.js plugin interface
  return {
    id: 'code-editor',

    // The runner can obtain the adapter from the plugin instance.
    sourceProvider,

    init(revealDeck) {
      deck = revealDeck;

      deck.on('ready', onReady);
      deck.on('slidechanged', onSlideChanged);
      deck.on('fragmentshown', onFragmentChanged);
      deck.on('fragmenthidden', onFragmentChanged);

      // Support initialization if the deck is already ready.
      if (typeof deck.isReady === 'function' && deck.isReady()) {
        mountSlide(deck.getCurrentSlide());
      }
    },

    destroy() {
      if (deck) {
        deck.off('ready', onReady);
        deck.off('slidechanged', onSlideChanged);
        deck.off('fragmentshown', onFragmentChanged);
        deck.off('fragmenthidden', onFragmentChanged);
      }

      unmountAll();

      editors.clear();
      sourceElements.clear();

      deck = null;
    }
  };
};

export default CodeEditor;
