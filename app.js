// function getVar(el, prop) {
//   return getComputedStyle(el).getPropertyValue('--' + prop);
// }

function setVar(el, prop, val) {
  return el.style.setProperty('--' + prop, val);
}

const root = document.querySelector('main');
const help = document.querySelector('#help');
const layerSelect = document.querySelector('#layer');
const layers = {};

document.querySelector('#opacity').oninput = (e) => {
  setVar(document.documentElement, 'opacity', e.target.value / 100);
};

document.querySelector('#flip').onclick = () => {
  root.classList.toggle('flip');
};

// let scale = 1;
let visible = null;

function moveTo(i) {
  if (i < 0) return;
  if (i >= pm.length) return;

  console.log(`moveTo(${i})`);
  layerSelect.value = i;
  pm[visible].hidden = true;
  visible = i;
  pm[visible].hidden = false;
  updateAllLayers();
}

function handleKey(key) {
  if (key === 'w' || key === 'arrowup') {
    // up
    moveTo(visible - 1);
  }

  if (key === 's' || key === 'arrowdown') {
    moveTo(visible + 1);
  }

  if (key === 'f' || key === 'arrowleft' || key === 'arrowright') {
    // flip
    root.classList.toggle('flip');
  }
}

document.documentElement.addEventListener('keyup', (e) => {
  handleKey(e.key.toLowerCase());
});

function updateAllLayers() {
  for (const l in layers) {
    layers[l].update();
  }
}

function addLayers(val, text) {
  const front = new Image();
  front.src = `./pm/front-${val}.png`;
  front.hidden = true;
  front.className = 'layer';
  root.append(front);

  const back = new Image();
  back.src = `./pm/back-${val}.png`;
  back.hidden = true;
  back.className = 'layer';
  root.append(back);

  const wrapper = document.createElement('li');
  wrapper.className = 'allow';
  const label = document.createElement('label');
  label.textContent = text || val;
  const state = document.createElement('input');
  state.type = 'checkbox';
  state.name = val;
  state.id = val;
  label.setAttribute('for', val);
  wrapper.append(state);
  wrapper.append(label);
  help.append(wrapper);

  layers[val] = {
    front,
    back,
    state,
    toggle() {
      state.checked = !state.checked;
      this.update();
    },
    update() {
      const showFront = visible < 3;
      front.hidden = true;
      back.hidden = true;
      if (state.checked) {
        if (showFront) {
          front.hidden = false;
        } else {
          back.hidden = false;
        }
      }
    },
  };

  state.onchange = () => layers[val].update();
}

const pm = Array.from({ length: 6 }, (_, i) => {
  const img = new Image();
  img.src = `./pm/${i + 1}.jpg`;
  img.hidden = true;
  root.append(img);

  visible = i;

  return img;
});

[['gnd'], ['vbat', 'vbat 1.5v'], ['vcc', 'vcc 3v'], ['nets', 'nets']].forEach(
  ([val, label]) => addLayers(val, label)
);

layerSelect.oninput = (e) => {
  const value = parseInt(e.target.value, 10);
  moveTo(value);
};

console.log({ pm, visible });

pm[visible].hidden = false;
moveTo(5);
