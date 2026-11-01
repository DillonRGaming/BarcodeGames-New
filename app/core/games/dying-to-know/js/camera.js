/**
 * Camera.js - Viewport, Perspective, Layout Framing, and Scene Bounds
 */

class Camera {
  constructor({ containerEl, gridEl }) {
    this.container = containerEl;
    this.grid = gridEl;

    this.isLineup = false;
    this.mode = 'lobby';
    this.perspective = 1200;
  }

  setPerspective(val) {
    this.perspective = val;
    if (this.container) {
      this.container.style.perspective = `${val}px`;
    }
  }

  setGridMode(mode) {
    this.mode = mode;
    this.isLineup = (mode === 'lineup');

    if (this.container) {
      this.container.classList.toggle('lineup', this.isLineup);
    }
    if (this.grid) {
      this.grid.classList.remove('lobby', 'grid-layout', 'lineup');
      if (mode === 'lobby') {
        this.grid.classList.add('lobby');
        this.grid.classList.remove('hide-names');
      } else if (mode === 'grid') {
        this.grid.classList.add('grid-layout');
        this.grid.classList.remove('hide-names');
      } else if (mode === 'lineup') {
        this.grid.classList.add('lineup');
      }
    }
  }

  setLineupMode(active) {
    this.setGridMode(active ? 'lineup' : 'grid');
  }

  toggleLineup() {
    this.isLineup = !this.isLineup;
    this.setGridMode(this.isLineup ? 'lineup' : 'grid');
    return this.isLineup;
  }

  getViewportBounds() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      aspect: window.innerWidth / window.innerHeight
    };
  }
}
