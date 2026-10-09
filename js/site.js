(function (window, document) {
    'use strict';

    var OD = window.OriginDossier = window.OriginDossier || {};

    if (typeof OD.initMarkdownViewers === 'function') {
        OD.initMarkdownViewers();
    }

    if (typeof OD.initLawArticlePopup === 'function') {
        OD.initLawArticlePopup();
    }


    if (typeof window.print === 'function') {
        document.querySelectorAll('[data-print-control]').forEach(function (control) {
            control.hidden = false;
        });
    }

    document.addEventListener('click', function (event) {
        var printButton = event.target.closest('[data-print-button]');
        if (printButton && typeof window.print === 'function') {
            event.preventDefault();
            window.print();
            return;
        }

        var backLink = event.target.closest('.dossier-back-link');
        if (backLink) {
            var referrer = document.referrer || '';
            var sameOrigin = false;
            try {
                sameOrigin = !!referrer && new URL(referrer).origin === window.location.origin;
            } catch (error) {
                sameOrigin = false;
            }

            if (sameOrigin && window.history.length > 1) {
                event.preventDefault();
                window.history.back();
                return;
            }

            var fallbackUrl = backLink.getAttribute('data-fallback-url') || backLink.getAttribute('href') || '/';
            event.preventDefault();
            window.location.href = fallbackUrl;
            return;
        }

        var contextLink = event.target.closest('.dossier-context-link');
        if (contextLink && typeof OD.captureCurrentTimelineState === 'function') {
            OD.captureCurrentTimelineState();
        }
    });
})(window, document);
