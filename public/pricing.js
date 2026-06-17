// Single display source for the monthly price.
// Fills every [data-flock-price] element (its attribute is a template using {price}) and
// exposes window.FLOCK_MONTHLY_PRICE for JS-generated strings. The number already in the
// element is just a fallback shown if the fetch fails or is slow, the authoritative value
// is MONTHLY_PRICE_INR on the server, surfaced via /api/subscription/pricing.
(function () {
  function apply(price) {
    window.FLOCK_MONTHLY_PRICE = price;
    document.querySelectorAll('[data-flock-price]').forEach(function (el) {
      el.textContent = el.getAttribute('data-flock-price').replace('{price}', price);
    });
  }
  fetch('/api/subscription/pricing')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && typeof d.monthlyPrice === 'number') apply(d.monthlyPrice); })
    .catch(function () {});
})();
