const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const http = (url) => post("/widgets/http", { url }).then((r) => {
  if (!r.ok) throw new Error(r.error);
  return JSON.parse(r.text);
});
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// WMO 天气码 → 图标 + 说法
const WMO = [
  [[0], "☀️", "晴"], [[1], "🌤️", "大致晴"], [[2], "⛅", "多云"], [[3], "☁️", "阴"],
  [[45, 48], "🌫️", "雾"], [[51, 53, 55, 56, 57], "🌦️", "毛毛雨"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "雨"], [[71, 73, 75, 77, 85, 86], "🌨️", "雪"],
  [[95, 96, 99], "⛈️", "雷雨"],
];
const wmo = (code) => WMO.find(([codes]) => codes.includes(code)) || [[], "🌡️", "—"];

const DEFAULT_CITY = { name: "北京", latitude: 39.9075, longitude: 116.39723 };
let city = DEFAULT_CITY;
try { city = JSON.parse(localStorage.getItem("city")) || DEFAULT_CITY; } catch { /* 用缺省 */ }

const load = async () => {
  cityname.textContent = city.name;
  try {
    const d = await http("https://api.open-meteo.com/v1/forecast" +
      `?latitude=${city.latitude}&longitude=${city.longitude}` +
      "&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6");
    const c = d.current;
    const [, icon, desc] = wmo(c.weather_code);
    const lows = d.daily.temperature_2m_min, highs = d.daily.temperature_2m_max;
    const min = Math.min(...lows), max = Math.max(...highs), span = Math.max(max - min, 1);
    const dayName = (iso, i) => i === 0 ? "今天" : "周" + "日一二三四五六"[new Date(iso + "T12:00").getDay()];
    body.innerHTML = `
      <div class="now">
        <div class="icon">${icon}</div>
        <div>
          <div class="temp">${Math.round(c.temperature_2m)}<sup>°C</sup></div>
          <div class="desc">${desc} · 体感 ${Math.round(c.apparent_temperature)}°</div>
        </div>
      </div>
      <div class="chips">
        <span class="chip">💧 湿度 ${c.relative_humidity_2m}%</span>
        <span class="chip">🍃 风 ${Math.round(c.wind_speed_10m)} km/h</span>
      </div>
      <div class="days">${d.daily.time.map((t, i) => {
        const [, dicon] = wmo(d.daily.weather_code[i]);
        const left = ((lows[i] - min) / span) * 100, width = ((highs[i] - lows[i]) / span) * 100;
        return `<div class="dayrow"><span class="${i === 0 ? "" : "dim"}">${dayName(t, i)}</span><span>${dicon}</span>
          <div class="bar"><i style="left:${left}%;width:${Math.max(width, 4)}%"></i></div>
          <span><span class="lo">${Math.round(lows[i])}°</span> ${Math.round(highs[i])}°</span></div>`;
      }).join("")}</div>`;
  } catch (e) {
    body.innerHTML = `<div class="err">拿不到天气:${esc(e.message)}</div>`;
  }
};

citybtn.onclick = () => { search.hidden = !search.hidden; if (!search.hidden) q.focus(); };
let timer = null;
q.oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const name = q.value.trim();
    if (!name) { hits.innerHTML = ""; return; }
    try {
      const d = await http(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=zh`);
      hits.innerHTML = (d.results || []).map((r, i) =>
        `<button data-i="${i}">${esc(r.name)}<small>${esc([r.admin1, r.country].filter(Boolean).join(" · "))}</small></button>`).join("")
        || '<div class="empty">没找到</div>';
      hits.results = d.results || [];
    } catch { hits.innerHTML = '<div class="empty">搜索失败</div>'; }
  }, 300);
};
hits.onclick = (e) => {
  const i = e.target.closest("[data-i]")?.dataset.i;
  if (i == null) return;
  const r = hits.results[i];
  city = { name: r.name, latitude: r.latitude, longitude: r.longitude };
  localStorage.setItem("city", JSON.stringify(city));
  search.hidden = true; q.value = ""; hits.innerHTML = "";
  load();
};
refresh.onclick = load;

load();
setInterval(load, 30 * 60 * 1000);
