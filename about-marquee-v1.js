function makeCubicBezier(x1, y1, x2, y2) {
  const sampleX = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const sampleY = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const dX = (t) => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xt = sampleX(t) - x;
      if (Math.abs(xt) < 1e-6) break;
      const d = dX(t);
      if (d === 0) break;
      t -= xt / d;
    }
    return sampleY(t);
  };
}
const advanceEase = makeCubicBezier(0.77, 0, 0.18, 1);

function initSmoothMarquee() {
  const wrappers = document.querySelectorAll('[data-draggable-marquee-init]');

  wrappers.forEach((wrapper) => {
    if (wrapper.getAttribute('data-draggable-marquee-init') === 'initialized') return;

    const collection = wrapper.querySelector('[data-draggable-marquee-collection]');
    const list = wrapper.querySelector('[data-draggable-marquee-list]');
    if (!collection || !list) return;

    const speedAttr = parseFloat(wrapper.getAttribute('data-speed'));
    const autoScrollSpeed = Number.isNaN(speedAttr) ? 0.4 : speedAttr;

    const dragSensAttr = parseFloat(wrapper.getAttribute('data-drag-sensitivity'));
    const dragSensitivity = Number.isNaN(dragSensAttr) ? 0.5 : dragSensAttr;

    const directionAttr = (wrapper.getAttribute('data-direction') || 'left').toLowerCase();
    const directionMultiplier = directionAttr === 'right' ? 1 : -1;

    const baseVelocity = autoScrollSpeed * directionMultiplier;

    let currentVelocity = baseVelocity;
    let position = 0;
    let isDragging = false;
    let isHovered = false;

    const wrapperWidth = wrapper.getBoundingClientRect().width;
    const listWidth = list.scrollWidth || list.getBoundingClientRect().width;
    if (!wrapperWidth || !listWidth) return;

    const minRequiredWidth = wrapperWidth + listWidth + 2;
    while (collection.scrollWidth < minRequiredWidth) {
      const listClone = list.cloneNode(true);
      listClone.setAttribute('aria-hidden', 'true');
      collection.appendChild(listClone);
    }

    const wrapX = gsap.utils.wrap(-listWidth, 0);

    wrapper.addEventListener('mouseenter', () => { isHovered = true; });
    wrapper.addEventListener('mouseleave', () => { isHovered = false; });

    let advanceTween = null;
    function advanceBy(deltaPx, duration = 0.7) {
      if (advanceTween) advanceTween.kill();
      const start = position;
      const target = position + deltaPx;
      currentVelocity = 0;
      const proxy = { p: 0 };
      advanceTween = gsap.to(proxy, {
        p: 1,
        duration,
        ease: advanceEase,
        onUpdate() {
          position = start + (target - start) * proxy.p;
        },
        onComplete() {
          advanceTween = null;
        }
      });
    }

    function tick() {
      if (!advanceTween) {
        if (!isDragging) {
          const targetVelocity = isHovered ? 0 : baseVelocity;
          currentVelocity += (targetVelocity - currentVelocity) * 0.05;
        }
        position += currentVelocity;
      }
      position = wrapX(position);

      gsap.set(collection, { x: position });
    }

    const marqueeObserver = Observer.create({
      target: wrapper,
      type: 'pointer,touch',
      preventDefault: true,
      onPress: () => {
        isDragging = true;
        currentVelocity = 0;
        if (advanceTween) advanceTween.kill();
      },
      onChangeX: (e) => {
        position += e.deltaX * dragSensitivity;
        currentVelocity = (e.velocityX * dragSensitivity) / 60;
      },
      onRelease: () => {
        isDragging = false;
      },
      onClick: () => {
        wrapper.dispatchEvent(new CustomEvent('marquee:tap'));
      }
    });

    wrapper.__marquee = { advanceBy };

    ScrollTrigger.create({
      trigger: wrapper,
      start: 'top bottom',
      end: 'bottom top',
      onEnter: () => {
        gsap.ticker.add(tick);
        marqueeObserver.enable();
      },
      onLeave: () => {
        gsap.ticker.remove(tick);
        marqueeObserver.disable();
      },
      onEnterBack: () => {
        gsap.ticker.add(tick);
        marqueeObserver.enable();
      },
      onLeaveBack: () => {
        gsap.ticker.remove(tick);
        marqueeObserver.disable();
      }
    });

    wrapper.setAttribute('data-draggable-marquee-init', 'initialized');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSmoothMarquee();
});
