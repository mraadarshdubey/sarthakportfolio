/*
 * HOMEPAGE INTERACTIONS & RUNTIME OPTIMIZATIONS
 * Plain browser JavaScript. No React, dependencies, bundler, or network imports.
 * Optimized for deferred media loading, viewport-aware animation loops, and zero layout thrashing.
 */
'use strict';

const select = (selector, parent = document) => parent.querySelector(selector);
const selectAll = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function initializeHeader() {
  const header = select('[data-role="site-header"]');
  if (!header) return;
  const toggle = select('[data-action="toggle-menu"]');
  const menu = select('#mobile-menu');
  const menuIcon = toggle ? select('svg', toggle) : null;
  const menuIconPaths = menuIcon ? menuIcon.innerHTML : '';
  let previousOverflow = '';
  if (menu) menu.setAttribute('aria-label', 'Mobile navigation');

  function closeMenu(focusTarget = toggle) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = previousOverflow;
    if (menuIcon) menuIcon.innerHTML = menuIconPaths;
    focusTarget?.focus({ preventScroll: true });
  }

  if (toggle && menu) {
    const menuLinks = selectAll('a[href]', menu);
    const focusOrder = [toggle, ...menuLinks];

    toggle.addEventListener('click', () => {
      if (!menu.hidden) {
        closeMenu();
        return;
      }
      previousOverflow = document.body.style.overflow;
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      if (menuIcon) {
        menuIcon.innerHTML = '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>';
      }
      if (!reducedMotion.matches) {
        menu.animate([{ opacity: 0, transform: 'translateY(-20px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 250 });
      }
      (menuLinks[0] || toggle).focus({ preventScroll: true });
    });

    menu.addEventListener('click', event => {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', event => {
      if (menu.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      } else if (event.key === 'Tab') {
        const current = focusOrder.indexOf(document.activeElement);
        const direction = event.shiftKey ? -1 : 1;
        const next = current === -1 ? (event.shiftKey ? focusOrder.length - 1 : 0)
          : (current + direction + focusOrder.length) % focusOrder.length;
        event.preventDefault();
        focusOrder[next].focus({ preventScroll: true });
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768 && !menu.hidden) {
        const focusWasInMenu = focusOrder.includes(document.activeElement);
        closeMenu(focusWasInMenu ? select('.header-brand', header) : null);
      }
    });
  }

  // Batch header scroll updates in requestAnimationFrame to eliminate forced reflow
  let isScrolled = false;
  let scrollTicking = false;
  function updateHeader() {
    const scrolled = window.scrollY > 20;
    if (scrolled !== isScrolled) {
      isScrolled = scrolled;
      header.classList.toggle('is-scrolled', scrolled);
    }
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(() => {
        updateHeader();
        scrollTicking = false;
      });
    }
  }, { passive: true });
  updateHeader();
}

function initializeBackToTop() {
  const button = select('.footer-back-to-top');
  if (!button) return;
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  });
}

function initializeHeroCarousel() {
  const stage = select('[data-role="hero-carousel"]');
  if (!stage) return;
  const heroSection = select('#hero') || stage;
  const cards = selectAll('[data-card-index]', stage);
  const videos = selectAll('video', stage);
  const label = select('[data-role="hero-card-label"]');
  const dial = select('div[style*="rotate"]', stage);
  const audio = select('[data-action="toggle-audio"]');
  const audioIcon = audio ? select('svg', audio) : null;
  const mutedIconPaths = audioIcon ? audioIcon.innerHTML : '';
  const enabledIconPaths = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.41 7.59A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .994.41l3.386 3.387A.705.705 0 0 0 11 19.298z"></path><path d="M16 9a5 5 0 0 1 0 6"></path><path d="M19.364 5.636a9 9 0 0 1 0 12.728"></path>';
  const labels = cards.map((card, index) => card.dataset.cardLabel || (index === 0 ? 'ME' : `PROJECT ${index}`));

  let activeIndex = 0;
  let audioEnabled = false;
  let audioBlocked = false;
  let audioRequest = 0;
  let hovering = false;
  let dragStart = null;
  let dragged = false;
  let lastTime = performance.now();
  const started = lastTime;
  const states = cards.map(() => ({ x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1, vx: 0, vy: 0, vr: 0, vry: 0, vs: 0 }));
  let dialAngle = 0;
  let dialVelocity = 0;

  let animationFrameId = null;
  let isHeroVisible = true;
  let rotateIntervalId = null;

  function updateAudioButton() {
    if (!audio) return;
    const hasVideo = Boolean(select('video', cards[activeIndex]));
    const enabled = hasVideo && audioEnabled && !audioBlocked;
    const audioLabel = select('[data-role="audio-label"]', audio);
    if (audioLabel) {
      audioLabel.textContent = !hasVideo ? 'NO AUDIO ON THIS CARD'
        : audioBlocked ? 'ENABLE AUDIO'
        : enabled ? 'MUTE AUDIO' : 'UNMUTE AUDIO';
    }
    audio.disabled = !hasVideo;
    audio.setAttribute('aria-pressed', String(enabled));
    audio.classList.toggle('audio-enabled', enabled);
    if (audioIcon) audioIcon.innerHTML = enabled ? enabledIconPaths : mutedIconPaths;
  }

  function syncHeroAudio() {
    const request = ++audioRequest;
    // Mute the old card before giving the selected card permission to play sound.
    videos.forEach(video => { video.muted = true; });
    audioBlocked = false;
    const activeVideo = select('video', cards[activeIndex]);
    updateAudioButton();
    if (!audioEnabled || !activeVideo || document.hidden || !isHeroVisible) return;

    activeVideo.muted = false;
    activeVideo.play().catch(() => {
      // A rejected request from an earlier card must not change the current card.
      if (request !== audioRequest) return;
      activeVideo.muted = true;
      audioBlocked = true;
      updateAudioButton();
    });
  }

  function getTarget(index) {
    let offset = (index - activeIndex + cards.length) % cards.length;
    if (offset > cards.length / 2) offset -= cards.length;
    const distance = Math.abs(offset);
    return {
      x: offset === 0 ? 0 : Math.sign(offset) * (distance === 1 ? 215 : 395),
      y: distance === 0 ? 0 : distance === 1 ? 22 : 54,
      rotate: offset * 11,
      rotateY: -offset * 14,
      scale: distance === 0 ? 1.06 : distance === 1 ? 0.86 : 0.74,
      opacity: offset === 0 ? 1 : 0.85 - distance * 0.08,
      zIndex: offset === 0 ? 30 : 20 - distance * 5
    };
  }

  function renderStatic() {
    cards.forEach((card, index) => {
      const target = getTarget(index);
      card.style.transform = `translateX(${target.x}px) translateY(${target.y}px) rotate(${target.rotate}deg) rotateY(${target.rotateY}deg) scale(${target.scale})`;
      card.style.zIndex = target.zIndex;
      card.style.opacity = target.opacity;
    });
    if (dial) {
      const target = -activeIndex * (360 / cards.length);
      dial.style.transform = `rotate(${target}deg)`;
    }
  }

  function setActive(index) {
    activeIndex = (index + cards.length) % cards.length;
    if (label) label.textContent = labels[activeIndex];
    cards.forEach((card, i) => {
      card.classList.toggle('is-active', i === activeIndex);
      card.setAttribute('aria-current', String(i === activeIndex));
      const target = getTarget(i);
      card.style.zIndex = target.zIndex;
      card.style.opacity = target.opacity;
    });
    if (reducedMotion.matches) {
      renderStatic();
    }
    syncHeroAudio();
  }

  function move(direction) { setActive(activeIndex + direction); }

  selectAll('[data-action="previous-card"]').forEach(button => button.addEventListener('click', () => move(-1)));
  selectAll('[data-action="next-card"]').forEach(button => button.addEventListener('click', () => move(1)));

  cards.forEach((card, index) => {
    card.addEventListener('click', event => {
      if (event.target.closest('a') || dragged) return;
      setActive(index);
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setActive(index);
      }
    });
  });

  stage.addEventListener('mouseenter', () => { hovering = true; });
  stage.addEventListener('mouseleave', () => { hovering = false; dragStart = null; });
  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('a,button')) return;
    dragStart = event.clientX;
    dragged = false;
  });
  stage.addEventListener('pointermove', event => {
    if (dragStart === null) return;
    const distance = event.clientX - dragStart;
    if (Math.abs(distance) > 50) {
      move(distance > 0 ? -1 : 1);
      dragged = true;
      dragStart = null;
    }
  });
  window.addEventListener('pointerup', () => {
    dragStart = null;
    setTimeout(() => { dragged = false; }, 0);
  });
  stage.addEventListener('pointercancel', () => { dragStart = null; });

  stage.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,[role="slider"],[contenteditable]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  });

  function startRotationTimer() {
    if (rotateIntervalId !== null) return;
    rotateIntervalId = setInterval(() => {
      if (!hovering && dragStart === null && !document.hidden && isHeroVisible && !reducedMotion.matches) {
        move(-1);
      }
    }, 3200);
  }

  function stopRotationTimer() {
    if (rotateIntervalId !== null) {
      clearInterval(rotateIntervalId);
      rotateIntervalId = null;
    }
  }

  if (audio) {
    audio.addEventListener('click', () => {
      audioEnabled = audioBlocked || !audioEnabled;
      syncHeroAudio();
    });
  }

  videos.forEach(video => {
    video.muted = true;
    video.defaultMuted = true;
  });

  function spring(state, property, velocity, target, elapsed) {
    const acceleration = 220 * (target - state[property]) - 25 * state[velocity];
    state[velocity] += acceleration * elapsed;
    state[property] += state[velocity] * elapsed;
  }

  states.forEach((state, index) => Object.assign(state, getTarget(index)));
  setActive(0);

  function draw(now) {
    if (!isHeroVisible || document.hidden || reducedMotion.matches) {
      animationFrameId = null;
      return;
    }
    const elapsed = Math.min((now - lastTime) / 1000, 0.032);
    lastTime = now;

    cards.forEach((card, index) => {
      const target = getTarget(index);
      const state = states[index];
      for (const [property, velocity] of [['x','vx'],['y','vy'],['rotate','vr'],['rotateY','vry'],['scale','vs']]) {
        spring(state, property, velocity, target[property], elapsed);
      }
      const phase = ((now - started) % 3500) / 3500;
      const float = index === activeIndex ? -3 + 3 * Math.cos(phase * Math.PI * 2) : 0;
      card.style.transform = `translateX(${state.x}px) translateY(${state.y + float}px) rotate(${state.rotate}deg) rotateY(${state.rotateY}deg) scale(${state.scale})`;
    });

    if (dial) {
      const target = -activeIndex * (360 / cards.length);
      dialVelocity += ((200 * (target - dialAngle) - 25 * dialVelocity) / 0.8) * elapsed;
      dialAngle += dialVelocity * elapsed;
      dial.style.transform = `rotate(${dialAngle}deg)`;
    }

    animationFrameId = requestAnimationFrame(draw);
  }

  function startAnimation() {
    if (reducedMotion.matches) {
      renderStatic();
      return;
    }
    if (animationFrameId !== null) return;
    if (!isHeroVisible || document.hidden) return;
    lastTime = performance.now();
    animationFrameId = requestAnimationFrame(draw);
    startRotationTimer();
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    stopRotationTimer();
  }

  // Observe #hero to pause carousel physics, videos, and timers when offscreen
  const heroObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      isHeroVisible = entry.isIntersecting;
      syncHeroAudio();
      if (isHeroVisible && !document.hidden) {
        videos.forEach(v => {
          if (v.paused) v.play().catch(() => {});
        });
        startAnimation();
      } else {
        videos.forEach(v => {
          if (!v.paused) v.pause();
        });
        stopAnimation();
      }
    }
  }, { threshold: 0.01 });
  heroObserver.observe(heroSection);

  document.addEventListener('visibilitychange', () => {
    syncHeroAudio();
    if (document.hidden) {
      videos.forEach(v => { if (!v.paused) v.pause(); });
      stopAnimation();
    } else if (isHeroVisible) {
      videos.forEach(v => { if (v.paused) v.play().catch(() => {}); });
      startAnimation();
    }
  });

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      stopAnimation();
      renderStatic();
    } else if (isHeroVisible && !document.hidden) {
      startAnimation();
    }
  });

  if (reducedMotion.matches) {
    renderStatic();
  } else {
    startAnimation();
  }
}

// Defer offscreen video loading & manage playback for marquee and archive cards
function initializeVideoPreviews() {
  const videos = selectAll('[data-preview]');
  if (!videos.length) return;

  function loadAndPlay(video) {
    if (video.dataset.src && (!video.src || video.src === window.location.href)) {
      video.src = video.dataset.src;
      video.load();
    }
    video.muted = true;
    if (!document.hidden) {
      video.play().catch(() => {});
    }
  }

  function pauseVideo(video) {
    if (!video.paused) {
      video.pause();
    }
  }

  const activeInteractions = new WeakSet();

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) {
        loadAndPlay(video);
      } else if (!activeInteractions.has(video)) {
        pauseVideo(video);
      }
    }
  }, { threshold: 0.05, rootMargin: '200px 40px 200px 40px' });

  videos.forEach(video => {
    observer.observe(video);

    const card = video.closest('.project-card') || video.closest('a') || video;

    const onEnter = () => {
      activeInteractions.add(video);
      loadAndPlay(video);
    };

    const onLeave = () => {
      activeInteractions.delete(video);
      const rect = video.getBoundingClientRect();
      const inView = rect.bottom > -200 && rect.top < window.innerHeight + 200
        && rect.right > -40 && rect.left < window.innerWidth + 40;
      if (!inView) {
        pauseVideo(video);
      }
    };

    card.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') onEnter();
    });
    card.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch') onLeave();
    });

    card.addEventListener('focusin', onEnter);
    card.addEventListener('focusout', onLeave);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      videos.forEach(v => pauseVideo(v));
    }
  });

  for (const track of selectAll('[data-marquee]')) {
    const viewport = track.parentElement;
    const pause = () => { track.style.animationPlayState = 'paused'; };
    const resume = () => { track.style.animationPlayState = ''; };
    viewport.addEventListener('mouseenter', pause);
    viewport.addEventListener('mouseleave', resume);
    viewport.addEventListener('touchstart', pause, { passive: true });
    viewport.addEventListener('touchend', resume, { passive: true });
    viewport.addEventListener('touchcancel', resume, { passive: true });
  }
}

// Comparison slider with cached layout dimensions and requestAnimationFrame batching
function initializeComparison() {
  const frame = select('[data-role="comparison-frame"]');
  if (!frame) return;
  const rawLayer = select('[data-role="comparison-raw-layer"]', frame);
  const raw = select('[data-role="comparison-raw-image"]', frame);
  const final = select('[data-role="comparison-final-image"]', frame);
  const handle = select('[data-role="comparison-handle"]', frame);
  const tabs = selectAll('[data-comparison]');
  const images = {
    cinematic: { raw: 'assets/images/mountain-before.jpg', final: 'assets/images/mountain-after.jpg' },
    streetwear: { raw: 'assets/images/streetwear-before.jpg', final: 'assets/images/streetwear-after.jpg' },
    commercial: { raw: 'assets/images/commercial-before.jpg', final: 'assets/images/commercial-after.jpg' }
  };

  let position = 50;
  let dragging = false;
  let cachedWidth = 0;
  let cachedLeft = 0;
  let renderScheduled = false;

  function measureFrame() {
    const bounds = frame.getBoundingClientRect();
    cachedWidth = bounds.width;
    cachedLeft = bounds.left;
  }

  function applyStyles() {
    frame.style.setProperty('--comparison-position', `${position}%`);
    rawLayer.style.width = `${position}%`;
    handle.style.left = `${position}%`;
    frame.setAttribute('aria-valuenow', String(Math.round(position)));
    renderScheduled = false;
  }

  function setPosition(value) {
    position = Math.max(0, Math.min(100, value));
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(applyStyles);
    }
  }

  function updateFromPointer(clientX) {
    if (cachedWidth > 0) {
      setPosition(((clientX - cachedLeft) / cachedWidth) * 100);
    }
  }

  frame.addEventListener('pointerdown', event => {
    dragging = true;
    measureFrame();
    frame.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX);
  });

  frame.addEventListener('pointermove', event => {
    if (dragging) {
      updateFromPointer(event.clientX);
    }
  });

  frame.addEventListener('pointerup', () => { dragging = false; });
  frame.addEventListener('pointercancel', () => { dragging = false; });

  frame.addEventListener('keydown', event => {
    const actions = { ArrowLeft: position - 5, ArrowRight: position + 5, Home: 0, End: 100 };
    if (event.key in actions) {
      event.preventDefault();
      setPosition(actions[event.key]);
    }
  });

  tabs.forEach(tab => tab.addEventListener('click', () => {
    const category = tab.dataset.comparison;
    if (images[category]) {
      raw.src = images[category].raw;
      final.src = images[category].final;
    }
    tabs.forEach(button => {
      const active = button === tab;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }));

  if (tabs[0]) {
    tabs[0].classList.add('is-selected');
    tabs[0].setAttribute('aria-pressed', 'true');
  }

  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      cachedWidth = entry.contentRect.width;
      cachedLeft = frame.getBoundingClientRect().left;
      raw.style.width = `${cachedWidth}px`;
      setPosition(position);
    }
  });
  resizeObserver.observe(frame);
  measureFrame();
  raw.style.width = `${cachedWidth}px`;
  applyStyles();
}

function initializeServices() {
  const triggers = selectAll('[data-service]');
  const panels = selectAll('[data-service-panel]');
  let openIndex = null;

  async function toggle(index) {
    const next = openIndex === index ? null : index;
    openIndex = next;
    triggers.forEach((trigger, current) => {
      const open = current === next;
      const panel = panels[current];
      trigger.setAttribute('aria-expanded', String(open));
      trigger.parentElement.classList.toggle('is-open', open);
      panel.getAnimations().forEach(animation => animation.cancel());

      if (open) {
        panel.hidden = false;
        const height = panel.scrollHeight;
        if (!reducedMotion.matches) {
          panel.animate([{ height: '0px', opacity: 0 }, { height: height + 'px', opacity: 1 }], { duration: 280, easing: 'ease-in-out' });
        }
      } else if (!panel.hidden) {
        if (reducedMotion.matches) {
          panel.hidden = true;
        } else {
          const height = panel.scrollHeight;
          const animation = panel.animate([{ height: height + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 280, easing: 'ease-in-out' });
          animation.finished.then(() => { if (openIndex !== current) panel.hidden = true; }).catch(() => {});
        }
      }
    });
  }

  triggers.forEach((trigger, index) => {
    trigger.addEventListener('click', () => toggle(index));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(index); }
    });
  });
}

function initializeScrollAnimations() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '-60px', threshold: 0 });

  selectAll('[data-reveal]').forEach(element => {
    element.style.transitionDelay = (Number(element.dataset.revealDelay) || 0) + 's';
    observer.observe(element);
  });
  document.documentElement.classList.add('js-ready');

  const counters = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      counters.unobserve(entry.target);
      const element = entry.target;
      const value = element.dataset.counter;
      if (reducedMotion.matches) { element.textContent = value; return; }
      const start = performance.now();
      function animate(now) {
        const progress = Math.min((now - start) / 1800, 1);
        const ease = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
        if (value.includes('24-48')) element.textContent = `${Math.round(24 * ease)}-${Math.round(48 * ease)}h`;
        else element.textContent = value.replace(/\d+/, number => String(Math.round(Number(number) * ease)));
        if (progress < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    });
  }, { rootMargin: '-40px' });
  selectAll('[data-counter]').forEach(element => counters.observe(element));
}

// Background Canvas with explicit top-section visibility policy & reduced motion support
function initializeDotBackground() {
  const canvas = select('[data-role="dot-canvas"]');
  if (!canvas) return;
  const context = canvas.getContext('2d', { alpha: false });
  let width = 0;
  let height = 0;
  let time = 0;
  let lastDrawTime = performance.now();
  let canvasFrameId = null;
  let isCanvasVisible = true;
  const mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000, active: false };

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    context.scale(ratio, ratio);
    if (reducedMotion.matches) drawStatic();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', event => {
    mouse.targetX = event.clientX;
    mouse.targetY = event.clientY;
    mouse.active = true;
  }, { passive: true });
  document.addEventListener('mouseleave', () => { mouse.active = false; mouse.targetX = mouse.targetY = -1000; });
  resize();

  function drawStatic() {
    context.fillStyle = '#ECEBE8';
    context.fillRect(0, 0, width, height);
    const spacing = width < 640 ? 24 : 28;
    const columns = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    const left = (width - (columns - 1) * spacing) / 2;
    const top = (height - (rows - 1) * spacing) / 2;
    for (let row = 0; row < rows; row++) {
      const y = top + row * spacing;
      for (let column = 0; column < columns; column++) {
        const x = left + column * spacing;
        context.beginPath();
        context.arc(x, y, 1.2, 0, Math.PI * 2);
        context.fillStyle = 'rgba(13,13,13,0.18)';
        context.fill();
      }
    }
  }

  function draw(now) {
    if (!isCanvasVisible || document.hidden || reducedMotion.matches) {
      canvasFrameId = null;
      return;
    }
    const elapsed = Math.min((now - lastDrawTime) / 1000, 0.032);
    lastDrawTime = now;
    time += elapsed;

    mouse.x += (mouse.targetX - mouse.x) * 0.1;
    mouse.y += (mouse.targetY - mouse.y) * 0.1;
    context.fillStyle = '#ECEBE8';
    context.fillRect(0, 0, width, height);

    const spacing = width < 640 ? 24 : 28;
    const columns = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    const left = (width - (columns - 1) * spacing) / 2;
    const top = (height - (rows - 1) * spacing) / 2;

    for (let row = 0; row < rows; row++) {
      const y = top + row * spacing;
      for (let column = 0; column < columns; column++) {
        const x = left + column * spacing;
        let strength = (Math.sin(x * 0.0035 + y * 0.0025 - time * 0.85) + Math.cos(x * 0.002 - y * 0.004 + time * 0.65) + Math.sin((x + y) * 0.005 + time * 1.1) * 0.5 + 2.5) / 5;
        const distance = Math.hypot(x - mouse.x, y - mouse.y);
        if (mouse.active && distance < 220) strength += (1 - distance / 220) ** 2 * 0.65;
        strength = Math.max(0, Math.min(1, strength));
        context.beginPath();
        context.arc(x, y, 1.1 + strength * 2.7, 0, Math.PI * 2);
        context.fillStyle = strength > 0.84 ? `rgba(230,62,38,${Math.min(0.65, 0.25 + (strength - 0.84) / 0.16 * 0.4)})` : `rgba(13,13,13,${0.1 + strength * 0.36})`;
        context.fill();
      }
    }
    canvasFrameId = requestAnimationFrame(draw);
  }

  function startCanvas() {
    if (reducedMotion.matches) {
      drawStatic();
      return;
    }
    if (canvasFrameId !== null) return;
    if (!isCanvasVisible || document.hidden) return;
    lastDrawTime = performance.now();
    canvasFrameId = requestAnimationFrame(draw);
  }

  function stopCanvas() {
    if (canvasFrameId !== null) {
      cancelAnimationFrame(canvasFrameId);
      canvasFrameId = null;
    }
  }

  // Explicit visibility policy for fixed background canvas:
  // Observe top sections where the canvas is visible to the user.
  const visibleRegions = selectAll('#hero, #about-intro, .archive-header, .biography-introduction, .connect-header, .case-header, .missing-page');
  if (visibleRegions.length) {
    const canvasObserver = new IntersectionObserver(entries => {
      // If any of the top visible regions intersect, keep canvas rendering active
      const anyVisible = visibleRegions.some(region => {
        const rect = region.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      isCanvasVisible = anyVisible;
      if (isCanvasVisible && !document.hidden) {
        startCanvas();
      } else {
        stopCanvas();
      }
    }, { threshold: 0.01 });

    visibleRegions.forEach(region => canvasObserver.observe(region));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopCanvas();
    } else if (isCanvasVisible) {
      startCanvas();
    }
  });

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      stopCanvas();
      drawStatic();
    } else if (isCanvasVisible && !document.hidden) {
      startCanvas();
    }
  });

  if (reducedMotion.matches) {
    drawStatic();
  } else {
    startCanvas();
  }
}

// Work archive: filter cards in place without synchronous layout thrashing
function initializeArchiveFilters() {
  const filters = selectAll('[data-filter]');
  if (!filters.length) return;
  const cards = selectAll('[data-project-category]');

  filters.forEach(button => {
    button.addEventListener('click', () => {
      const category = button.dataset.filter;
      filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));

      cards.forEach(card => {
        const visible = category === 'ALL' || card.dataset.projectCategory === category;
        card.hidden = !visible;
        if (visible) {
          card.classList.remove('is-visible');
          requestAnimationFrame(() => card.classList.add('is-visible'));
        } else {
          selectAll('video', card).forEach(video => {
            if (!video.paused) video.pause();
          });
        }
      });
    });
  });
}

// Initialize components
initializeHeader();
initializeBackToTop();
initializeHeroCarousel();
initializeVideoPreviews();
initializeComparison();
initializeServices();
initializeScrollAnimations();
initializeDotBackground();
initializeArchiveFilters();
