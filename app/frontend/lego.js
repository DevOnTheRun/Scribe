// ==Module==
// @name         Lego
// @description  A color framework and style system module providing a four-color framework with 120 pre-generated color mixtures, semantic utility colors, and pre-styled UI components
// @version      1.1.1
// ==/Module==

/*------------------------*/
/*      INTRODUCTION      */
/*------------------------*/

// Lego.js - A color framework and style system module for various projects
// 
// This module provides a four-color framework (primary, secondary, theme, contrast) with 120 pre-generated color mixtures,
// plus four semantic utility colors (red, yellow, green, blue) for status indicators.
// Projects can import this module and use the Lego.initialize() function to inject colors and styles.
// 
// Color variables follow a pattern: --lego-color-<colour> (base), --lego-color-<colour>-rgb (RGB values), or --lego-color-<type>-<mix> (mixtures)
// Example: --lego-color-primary is the primary colour, --lego-color-rgb-cp10 is 90% contrast + 10% primary in RGB color space.
// Semantic colors: --lego-color-red, --lego-color-yellow, --lego-color-green, --lego-color-blue (and -rgb variants)
//
// Available exports:
// - Lego.colors: 120 color mixture variables in both HSL and RGB color spaces
// - Lego.blocks: Default style blocks for common UI elements
// - Lego.initialize(): Main initialization function
// - Lego.load(): CSS loading function
// - Lego.show(contentId): Reveal a content element and hide its siblings
// - Lego.hide(id): Hide a container or content element by id
// - Lego.toggleAccordion(target): Expand or collapse an accordion item
// - Lego.mountAudioPlayer(el) / Lego.mountVideoPlayer(el): wire media player chrome
// - Lego.mountMarkdown(el) / Lego.renderMarkdown(text): fetch or render markdown into a viewer
// - Lego style combos (lego-style-*): presets that combine fill, border, and text; override with atomic utilities as needed

const Lego = (function() {
    'use strict';

    /*------------------------*/
    /*       CONSTANTS        */
    /*------------------------*/
    
    // CONSTANT // Default colours, used across projects
    const legoColors = {

        'hsl mixtures': {
            root: {
                // Primary + Theme mixtures (HSL)
                '--lego-color-hsl-pt10': 'color-mix(in hsl, var(--lego-color-primary) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-hsl-pt20': 'color-mix(in hsl, var(--lego-color-primary) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-hsl-pt30': 'color-mix(in hsl, var(--lego-color-primary) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-hsl-pt40': 'color-mix(in hsl, var(--lego-color-primary) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-hsl-pt50': 'color-mix(in hsl, var(--lego-color-primary) 50%, var(--lego-color-theme) 50%)',

                // Theme + Primary mixtures (HSL)
                '--lego-color-hsl-tp10': 'color-mix(in hsl, var(--lego-color-theme) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-hsl-tp20': 'color-mix(in hsl, var(--lego-color-theme) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-hsl-tp30': 'color-mix(in hsl, var(--lego-color-theme) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-hsl-tp40': 'color-mix(in hsl, var(--lego-color-theme) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-hsl-tp50': 'color-mix(in hsl, var(--lego-color-theme) 50%, var(--lego-color-primary) 50%)',

                // Primary + Contrast mixtures (HSL)
                '--lego-color-hsl-pc10': 'color-mix(in hsl, var(--lego-color-primary) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-hsl-pc20': 'color-mix(in hsl, var(--lego-color-primary) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-hsl-pc30': 'color-mix(in hsl, var(--lego-color-primary) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-hsl-pc40': 'color-mix(in hsl, var(--lego-color-primary) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-hsl-pc50': 'color-mix(in hsl, var(--lego-color-primary) 50%, var(--lego-color-contrast) 50%)',

                // Contrast + Primary mixtures (HSL)
                '--lego-color-hsl-cp10': 'color-mix(in hsl, var(--lego-color-contrast) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-hsl-cp20': 'color-mix(in hsl, var(--lego-color-contrast) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-hsl-cp30': 'color-mix(in hsl, var(--lego-color-contrast) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-hsl-cp40': 'color-mix(in hsl, var(--lego-color-contrast) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-hsl-cp50': 'color-mix(in hsl, var(--lego-color-contrast) 50%, var(--lego-color-primary) 50%)',

                // Theme + Contrast mixtures (HSL)
                '--lego-color-hsl-tc10': 'color-mix(in hsl, var(--lego-color-theme) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-hsl-tc20': 'color-mix(in hsl, var(--lego-color-theme) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-hsl-tc30': 'color-mix(in hsl, var(--lego-color-theme) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-hsl-tc40': 'color-mix(in hsl, var(--lego-color-theme) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-hsl-tc50': 'color-mix(in hsl, var(--lego-color-theme) 50%, var(--lego-color-contrast) 50%)',

                // Contrast + Theme mixtures (HSL)
                '--lego-color-hsl-ct10': 'color-mix(in hsl, var(--lego-color-contrast) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-hsl-ct20': 'color-mix(in hsl, var(--lego-color-contrast) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-hsl-ct30': 'color-mix(in hsl, var(--lego-color-contrast) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-hsl-ct40': 'color-mix(in hsl, var(--lego-color-contrast) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-hsl-ct50': 'color-mix(in hsl, var(--lego-color-contrast) 50%, var(--lego-color-theme) 50%)',

                // Primary + Secondary mixtures (HSL)
                '--lego-color-hsl-ps10': 'color-mix(in hsl, var(--lego-color-primary) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-hsl-ps20': 'color-mix(in hsl, var(--lego-color-primary) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-hsl-ps30': 'color-mix(in hsl, var(--lego-color-primary) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-hsl-ps40': 'color-mix(in hsl, var(--lego-color-primary) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-hsl-ps50': 'color-mix(in hsl, var(--lego-color-primary) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Primary mixtures (HSL)
                '--lego-color-hsl-sp10': 'color-mix(in hsl, var(--lego-color-secondary) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-hsl-sp20': 'color-mix(in hsl, var(--lego-color-secondary) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-hsl-sp30': 'color-mix(in hsl, var(--lego-color-secondary) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-hsl-sp40': 'color-mix(in hsl, var(--lego-color-secondary) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-hsl-sp50': 'color-mix(in hsl, var(--lego-color-secondary) 50%, var(--lego-color-primary) 50%)',

                // Theme + Secondary mixtures (HSL)
                '--lego-color-hsl-ts10': 'color-mix(in hsl, var(--lego-color-theme) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-hsl-ts20': 'color-mix(in hsl, var(--lego-color-theme) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-hsl-ts30': 'color-mix(in hsl, var(--lego-color-theme) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-hsl-ts40': 'color-mix(in hsl, var(--lego-color-theme) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-hsl-ts50': 'color-mix(in hsl, var(--lego-color-theme) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Theme mixtures (HSL)
                '--lego-color-hsl-st10': 'color-mix(in hsl, var(--lego-color-secondary) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-hsl-st20': 'color-mix(in hsl, var(--lego-color-secondary) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-hsl-st30': 'color-mix(in hsl, var(--lego-color-secondary) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-hsl-st40': 'color-mix(in hsl, var(--lego-color-secondary) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-hsl-st50': 'color-mix(in hsl, var(--lego-color-secondary) 50%, var(--lego-color-theme) 50%)',

                // Contrast + Secondary mixtures (HSL)
                '--lego-color-hsl-cs10': 'color-mix(in hsl, var(--lego-color-contrast) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-hsl-cs20': 'color-mix(in hsl, var(--lego-color-contrast) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-hsl-cs30': 'color-mix(in hsl, var(--lego-color-contrast) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-hsl-cs40': 'color-mix(in hsl, var(--lego-color-contrast) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-hsl-cs50': 'color-mix(in hsl, var(--lego-color-contrast) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Contrast mixtures (HSL)
                '--lego-color-hsl-sc10': 'color-mix(in hsl, var(--lego-color-secondary) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-hsl-sc20': 'color-mix(in hsl, var(--lego-color-secondary) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-hsl-sc30': 'color-mix(in hsl, var(--lego-color-secondary) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-hsl-sc40': 'color-mix(in hsl, var(--lego-color-secondary) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-hsl-sc50': 'color-mix(in hsl, var(--lego-color-secondary) 50%, var(--lego-color-contrast) 50%)'
            }
        },

        'rgb mixtures': {
            root: {
                // Primary + Theme mixtures (sRGB)
                '--lego-color-rgb-pt10': 'color-mix(in srgb, var(--lego-color-primary) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-rgb-pt20': 'color-mix(in srgb, var(--lego-color-primary) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-rgb-pt30': 'color-mix(in srgb, var(--lego-color-primary) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-rgb-pt40': 'color-mix(in srgb, var(--lego-color-primary) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-rgb-pt50': 'color-mix(in srgb, var(--lego-color-primary) 50%, var(--lego-color-theme) 50%)',

                // Theme + Primary mixtures (sRGB)
                '--lego-color-rgb-tp10': 'color-mix(in srgb, var(--lego-color-theme) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-rgb-tp20': 'color-mix(in srgb, var(--lego-color-theme) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-rgb-tp30': 'color-mix(in srgb, var(--lego-color-theme) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-rgb-tp40': 'color-mix(in srgb, var(--lego-color-theme) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-rgb-tp50': 'color-mix(in srgb, var(--lego-color-theme) 50%, var(--lego-color-primary) 50%)',

                // Primary + Contrast mixtures (sRGB)
                '--lego-color-rgb-pc10': 'color-mix(in srgb, var(--lego-color-primary) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-rgb-pc20': 'color-mix(in srgb, var(--lego-color-primary) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-rgb-pc30': 'color-mix(in srgb, var(--lego-color-primary) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-rgb-pc40': 'color-mix(in srgb, var(--lego-color-primary) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-rgb-pc50': 'color-mix(in srgb, var(--lego-color-primary) 50%, var(--lego-color-contrast) 50%)',

                // Contrast + Primary mixtures (sRGB)
                '--lego-color-rgb-cp10': 'color-mix(in srgb, var(--lego-color-contrast) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-rgb-cp20': 'color-mix(in srgb, var(--lego-color-contrast) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-rgb-cp30': 'color-mix(in srgb, var(--lego-color-contrast) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-rgb-cp40': 'color-mix(in srgb, var(--lego-color-contrast) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-rgb-cp50': 'color-mix(in srgb, var(--lego-color-contrast) 50%, var(--lego-color-primary) 50%)',

                // Theme + Contrast mixtures (sRGB)
                '--lego-color-rgb-tc10': 'color-mix(in srgb, var(--lego-color-theme) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-rgb-tc20': 'color-mix(in srgb, var(--lego-color-theme) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-rgb-tc30': 'color-mix(in srgb, var(--lego-color-theme) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-rgb-tc40': 'color-mix(in srgb, var(--lego-color-theme) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-rgb-tc50': 'color-mix(in srgb, var(--lego-color-theme) 50%, var(--lego-color-contrast) 50%)',

                // Contrast + Theme mixtures (sRGB)
                '--lego-color-rgb-ct10': 'color-mix(in srgb, var(--lego-color-contrast) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-rgb-ct20': 'color-mix(in srgb, var(--lego-color-contrast) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-rgb-ct30': 'color-mix(in srgb, var(--lego-color-contrast) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-rgb-ct40': 'color-mix(in srgb, var(--lego-color-contrast) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-rgb-ct50': 'color-mix(in srgb, var(--lego-color-contrast) 50%, var(--lego-color-theme) 50%)',

                // Primary + Secondary mixtures (sRGB)
                '--lego-color-rgb-ps10': 'color-mix(in srgb, var(--lego-color-primary) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-rgb-ps20': 'color-mix(in srgb, var(--lego-color-primary) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-rgb-ps30': 'color-mix(in srgb, var(--lego-color-primary) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-rgb-ps40': 'color-mix(in srgb, var(--lego-color-primary) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-rgb-ps50': 'color-mix(in srgb, var(--lego-color-primary) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Primary mixtures (sRGB)
                '--lego-color-rgb-sp10': 'color-mix(in srgb, var(--lego-color-secondary) 90%, var(--lego-color-primary) 10%)',
                '--lego-color-rgb-sp20': 'color-mix(in srgb, var(--lego-color-secondary) 80%, var(--lego-color-primary) 20%)',
                '--lego-color-rgb-sp30': 'color-mix(in srgb, var(--lego-color-secondary) 70%, var(--lego-color-primary) 30%)',
                '--lego-color-rgb-sp40': 'color-mix(in srgb, var(--lego-color-secondary) 60%, var(--lego-color-primary) 40%)',
                '--lego-color-rgb-sp50': 'color-mix(in srgb, var(--lego-color-secondary) 50%, var(--lego-color-primary) 50%)',

                // Theme + Secondary mixtures (sRGB)
                '--lego-color-rgb-ts10': 'color-mix(in srgb, var(--lego-color-theme) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-rgb-ts20': 'color-mix(in srgb, var(--lego-color-theme) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-rgb-ts30': 'color-mix(in srgb, var(--lego-color-theme) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-rgb-ts40': 'color-mix(in srgb, var(--lego-color-theme) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-rgb-ts50': 'color-mix(in srgb, var(--lego-color-theme) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Theme mixtures (sRGB)
                '--lego-color-rgb-st10': 'color-mix(in srgb, var(--lego-color-secondary) 90%, var(--lego-color-theme) 10%)',
                '--lego-color-rgb-st20': 'color-mix(in srgb, var(--lego-color-secondary) 80%, var(--lego-color-theme) 20%)',
                '--lego-color-rgb-st30': 'color-mix(in srgb, var(--lego-color-secondary) 70%, var(--lego-color-theme) 30%)',
                '--lego-color-rgb-st40': 'color-mix(in srgb, var(--lego-color-secondary) 60%, var(--lego-color-theme) 40%)',
                '--lego-color-rgb-st50': 'color-mix(in srgb, var(--lego-color-secondary) 50%, var(--lego-color-theme) 50%)',

                // Contrast + Secondary mixtures (sRGB)
                '--lego-color-rgb-cs10': 'color-mix(in srgb, var(--lego-color-contrast) 90%, var(--lego-color-secondary) 10%)',
                '--lego-color-rgb-cs20': 'color-mix(in srgb, var(--lego-color-contrast) 80%, var(--lego-color-secondary) 20%)',
                '--lego-color-rgb-cs30': 'color-mix(in srgb, var(--lego-color-contrast) 70%, var(--lego-color-secondary) 30%)',
                '--lego-color-rgb-cs40': 'color-mix(in srgb, var(--lego-color-contrast) 60%, var(--lego-color-secondary) 40%)',
                '--lego-color-rgb-cs50': 'color-mix(in srgb, var(--lego-color-contrast) 50%, var(--lego-color-secondary) 50%)',

                // Secondary + Contrast mixtures (sRGB)
                '--lego-color-rgb-sc10': 'color-mix(in srgb, var(--lego-color-secondary) 90%, var(--lego-color-contrast) 10%)',
                '--lego-color-rgb-sc20': 'color-mix(in srgb, var(--lego-color-secondary) 80%, var(--lego-color-contrast) 20%)',
                '--lego-color-rgb-sc30': 'color-mix(in srgb, var(--lego-color-secondary) 70%, var(--lego-color-contrast) 30%)',
                '--lego-color-rgb-sc40': 'color-mix(in srgb, var(--lego-color-secondary) 60%, var(--lego-color-contrast) 40%)',
                '--lego-color-rgb-sc50': 'color-mix(in srgb, var(--lego-color-secondary) 50%, var(--lego-color-contrast) 50%)'
            }
        }
    };

    // CONSTANT // Default style blocks
    const alphaSteps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    function legoAlphaUtilities(prefix, cssVar) {
        const utilities = {};
        for (const step of alphaSteps) {
            const key = String(step).padStart(3, '0');
            utilities[`.${prefix}-${key}`] = {
                [cssVar]: String(step / 100)
            };
        }
        return utilities;
    }

    const legoBlocks = {
        
        'utility styles': {
            '.lego-hidden': {
                'display': 'none !important'
            }
        },

        'press styles': {
            '.lego-bttn-pill::before, .lego-bttn-rect::before, .lego-bttn-sqr::before, .lego-bttn-rnd::before, .lego-style-bttnmain::before, .lego-style-bttnhollow::before, .lego-style-bttndanger::before, .lego-style-bttnsmall::before, .lego-tab::before, .lego-accordion-trigger::before': {
                'content': '""',
                'position': 'absolute',
                'inset': '0',
                'border-radius': 'inherit',
                'background-color': 'transparent',
                'pointer-events': 'none',
                'transition': 'background-color 0.15s ease'
            },
            '.lego-bttn-pill:hover:not(:disabled)::before, .lego-bttn-rect:hover:not(:disabled)::before, .lego-bttn-sqr:hover:not(:disabled)::before, .lego-bttn-rnd:hover:not(:disabled)::before, .lego-style-bttnmain:hover:not(:disabled)::before, .lego-style-bttnhollow:hover:not(:disabled)::before, .lego-style-bttndanger:hover:not(:disabled)::before, .lego-style-bttnsmall:hover:not(:disabled)::before, .lego-tab:hover:not(:disabled)::before, .lego-accordion-trigger:hover:not(:disabled)::before': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), 0.1)'
            },
            '.lego-bttn-pill:active:not(:disabled)::before, .lego-bttn-rect:active:not(:disabled)::before, .lego-bttn-sqr:active:not(:disabled)::before, .lego-bttn-rnd:active:not(:disabled)::before, .lego-style-bttnmain:active:not(:disabled)::before, .lego-style-bttnhollow:active:not(:disabled)::before, .lego-style-bttndanger:active:not(:disabled)::before, .lego-style-bttnsmall:active:not(:disabled)::before, .lego-tab:active:not(:disabled)::before, .lego-accordion-trigger:active:not(:disabled)::before': {
                'background-color': 'rgba(var(--lego-color-theme-rgb), 0.1)'
            }
        },

        // Style combos come before atomic bord/fill/text and shape overrides so those can still win
        'combo styles': {
            '.lego-style-bttnmain, .lego-style-bttnhollow, .lego-style-bttndanger, .lego-style-bttnsmall': {
                'display': 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center',
                'position': 'relative',
                'overflow': 'hidden',
                'cursor': 'pointer',
                'font-weight': '500',
                'line-height': '1',
                'transition': 'all 0.2s ease',
                'appearance': 'none',
                'box-sizing': 'border-box',
                'text-decoration': 'none'
            },
            '.lego-style-bttnmain:disabled, .lego-style-bttnhollow:disabled, .lego-style-bttndanger:disabled, .lego-style-bttnsmall:disabled': {
                'opacity': '0.5',
                'cursor': 'not-allowed'
            },
            '.lego-style-bttnmain, .lego-style-bttnhollow, .lego-style-bttndanger': {
                'padding': '10px 16px',
                'font-size': '14px',
                'border-radius': '999px'
            },
            '.lego-style-bttnmain': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 1))',
                'color': 'rgba(var(--lego-color-theme-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bttnhollow': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 1))',
                'background-color': 'transparent',
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bttndanger': {
                'border': '1px solid rgba(var(--lego-color-red-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-red-rgb), var(--lego-fill-a, 1))',
                'color': 'rgba(var(--lego-color-theme-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bttnsmall': {
                'width': '24px',
                'height': '24px',
                'padding': '0',
                'margin': '2px',
                'font-size': '12px',
                'flex-shrink': '0',
                'border-radius': '50%',
                'border': 'none',
                'background-color': 'transparent',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bttnsmall:hover:not(:disabled)': {
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-section': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.1))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bannerinfo': {
                'border': '2px solid rgba(var(--lego-color-blue-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-blue-rgb), var(--lego-fill-a, 0.2))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bannerwarning': {
                'border': '2px solid rgba(var(--lego-color-yellow-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-yellow-rgb), var(--lego-fill-a, 0.2))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bannererror': {
                'border': '2px solid rgba(var(--lego-color-red-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-red-rgb), var(--lego-fill-a, 0.2))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-bannersuccess': {
                'border': '2px solid rgba(var(--lego-color-green-rgb), var(--lego-bord-a, 1))',
                'background-color': 'rgba(var(--lego-color-green-rgb), var(--lego-fill-a, 0.2))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-input': {
                'width': '100%',
                'padding': '8px',
                'border-radius': '4px',
                'font-size': '14px',
                'box-sizing': 'border-box',
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.2))',
                'background-color': 'rgba(var(--lego-color-theme-rgb), var(--lego-fill-a, 1))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-input:focus': {
                'outline': 'none',
                'box-shadow': '0 0 0 2px rgba(var(--lego-color-primary-rgb), 0.35)'
            },
            '.lego-style-modal': {
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.1))',
                'background-color': 'rgba(var(--lego-color-theme-rgb), var(--lego-fill-a, 1))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-scrim': {
                'background-color': 'rgba(var(--lego-color-theme-rgb), var(--lego-fill-a, 0.5))',
                'backdrop-filter': 'blur(4px)',
                '-webkit-backdrop-filter': 'blur(4px)'
            },
            '.lego-style-muted': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.4))'
            },
            '.lego-style-chip': {
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.1))'
            },
            '.lego-style-tabs .lego-tab': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.4))'
            },
            '.lego-style-tabs .lego-tab-active': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-tabsactive .lego-tab-active': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.1))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-tabsactive .lego-tab-panel': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.1))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-accordion .lego-accordion-item': {
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.12))',
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.06))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-accordion .lego-accordion-trigger': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-accordion .lego-accordion-open > .lego-accordion-trigger': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.08))'
            },
            '.lego-style-accordion .lego-accordion-panel': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.85))',
                'border-top': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.1))'
            },
            '.lego-style-toggle': {
                'position': 'relative',
                'display': 'inline-block',
                'width': '48px',
                'height': '24px',
                'margin': '0 10px',
                'vertical-align': 'middle',
                'cursor': 'pointer',
                'flex-shrink': '0'
            },
            '.lego-style-toggle .lego-toggle-input': {
                'opacity': '0',
                'width': '0',
                'height': '0'
            },
            '.lego-style-toggle .lego-toggle-slider': {
                'position': 'absolute',
                'cursor': 'pointer',
                'top': '0',
                'left': '0',
                'right': '0',
                'bottom': '0',
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.3))',
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.12))',
                'transition': 'background-color 0.15s ease, border-color 0.15s ease',
                'border-radius': '24px'
            },
            '.lego-style-toggle .lego-toggle-slider:before': {
                'position': 'absolute',
                'content': '""',
                'height': '18px',
                'width': '18px',
                'left': '3px',
                'bottom': '3px',
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 1))',
                'transition': 'transform 0.15s ease, background-color 0.15s ease',
                'border-radius': '50%'
            },
            '.lego-style-toggle .lego-toggle-input:checked + .lego-toggle-slider': {
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 1))',
                'border-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.65))'
            },
            '.lego-style-toggle .lego-toggle-input:checked + .lego-toggle-slider:before': {
                'transform': 'translateX(24px)',
                'background-color': 'rgba(var(--lego-color-theme-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-style-scroll::-webkit-scrollbar': {
                'width': '8px'
            },
            '.lego-style-scroll::-webkit-scrollbar-track': {
                'background': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.1))'
            },
            '.lego-style-scroll::-webkit-scrollbar-thumb': {
                'background': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.3))',
                'border-radius': '4px'
            },
            '.lego-style-scroll::-webkit-scrollbar-thumb:hover': {
                'background': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.4))'
            },
            '.lego-style-playeraudio': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.45))',
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 0.08))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))',
                '--lego-player-wave': 'rgba(var(--lego-color-primary-rgb), 0.85)',
                '--lego-player-played': 'rgba(var(--lego-color-primary-rgb), 0.35)',
                '--lego-player-scrub': 'rgba(var(--lego-color-primary-rgb), 0.45)'
            },
            '.lego-style-playeraudio .lego-player-play': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.45))',
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 0.12))',
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-playeraudio .lego-player-time': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.55))'
            },
            '.lego-style-playervideo': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.45))',
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 0.08))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-playervideo .lego-player-play': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.45))',
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 0.12))',
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-playervideo .lego-player-time': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.55))'
            },
            '.lego-style-playervideo .lego-player-progress': {
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 0.2))'
            },
            '.lego-style-playervideo .lego-player-progress-fill': {
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-style-markdown': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-markdown a': {
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-style-markdown code, .lego-style-markdown pre': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.08))',
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.12))'
            },
            '.lego-style-markdown blockquote': {
                'border-left': '3px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 0.65))',
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 0.7))'
            },
            '.lego-style-markdown hr': {
                'border-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.15))'
            },
            '.lego-style-markdown th, .lego-style-markdown td': {
                'border-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 0.15))'
            },
            '.lego-style-markdown th': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 0.08))'
            }
        },

        // Shape building blocks — after combos so they can override default style shapes
        'button styles': {
            '.lego-bttn-pill, .lego-bttn-rect, .lego-bttn-sqr, .lego-bttn-rnd': {
                'display': 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center',
                'position': 'relative',
                'overflow': 'hidden',
                'cursor': 'pointer',
                'font-weight': '500',
                'line-height': '1',
                'transition': 'all 0.2s ease',
                'appearance': 'none',
                'box-sizing': 'border-box',
                'text-decoration': 'none'
            },
            '.lego-bttn-pill:disabled, .lego-bttn-rect:disabled, .lego-bttn-sqr:disabled, .lego-bttn-rnd:disabled': {
                'opacity': '0.5',
                'cursor': 'not-allowed'
            },
            '.lego-bttn-pill, .lego-bttn-rect': {
                'padding': '10px 16px',
                'font-size': '14px'
            },
            '.lego-bttn-pill': {
                'border-radius': '999px'
            },
            '.lego-bttn-rect': {
                'border-radius': '8px'
            },
            '.lego-bttn-sqr, .lego-bttn-rnd': {
                'width': '24px',
                'height': '24px',
                'padding': '0',
                'margin': '2px',
                'font-size': '12px',
                'flex-shrink': '0'
            },
            '.lego-bttn-sqr': {
                'border-radius': '4px'
            },
            '.lego-bttn-rnd': {
                'border-radius': '50%'
            }
        },

        'border styles': {
            '.lego-bord-p': {
                'border': '1px solid rgba(var(--lego-color-primary-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-s': {
                'border': '1px solid rgba(var(--lego-color-secondary-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-t': {
                'border': '1px solid rgba(var(--lego-color-theme-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-c': {
                'border': '1px solid rgba(var(--lego-color-contrast-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-r': {
                'border': '1px solid rgba(var(--lego-color-red-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-y': {
                'border': '1px solid rgba(var(--lego-color-yellow-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-g': {
                'border': '1px solid rgba(var(--lego-color-green-rgb), var(--lego-bord-a, 1))'
            },
            '.lego-bord-b': {
                'border': '1px solid rgba(var(--lego-color-blue-rgb), var(--lego-bord-a, 1))'
            },
            ...legoAlphaUtilities('lego-bord', '--lego-bord-a')
        },

        'fill styles': {
            '.lego-fill-p': {
                'background-color': 'rgba(var(--lego-color-primary-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-s': {
                'background-color': 'rgba(var(--lego-color-secondary-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-t': {
                'background-color': 'rgba(var(--lego-color-theme-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-c': {
                'background-color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-r': {
                'background-color': 'rgba(var(--lego-color-red-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-y': {
                'background-color': 'rgba(var(--lego-color-yellow-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-g': {
                'background-color': 'rgba(var(--lego-color-green-rgb), var(--lego-fill-a, 1))'
            },
            '.lego-fill-b': {
                'background-color': 'rgba(var(--lego-color-blue-rgb), var(--lego-fill-a, 1))'
            },
            ...legoAlphaUtilities('lego-fill', '--lego-fill-a')
        },

        'text styles': {
            '.lego-text-p': {
                'color': 'rgba(var(--lego-color-primary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-s': {
                'color': 'rgba(var(--lego-color-secondary-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-t': {
                'color': 'rgba(var(--lego-color-theme-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-c': {
                'color': 'rgba(var(--lego-color-contrast-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-r': {
                'color': 'rgba(var(--lego-color-red-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-y': {
                'color': 'rgba(var(--lego-color-yellow-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-g': {
                'color': 'rgba(var(--lego-color-green-rgb), var(--lego-text-a, 1))'
            },
            '.lego-text-b': {
                'color': 'rgba(var(--lego-color-blue-rgb), var(--lego-text-a, 1))'
            },
            ...legoAlphaUtilities('lego-text', '--lego-text-a')
        },

        'swatch styles': {
            '.lego-swatches': {
                'display': 'grid',
                'grid-template-columns': 'repeat(auto-fill, minmax(72px, 1fr))',
                'gap': '10px'
            },
            '.lego-swatch': {
                'display': 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                'gap': '6px'
            },
            '.lego-swatch-chip': {
                'width': '48px',
                'height': '48px',
                'border-radius': '50%',
                'flex-shrink': '0',
                'box-sizing': 'border-box'
            },
            '.lego-swatch-label': {
                'font-size': '0.7rem',
                'line-height': '1.2',
                'text-align': 'center'
            }
        },

        'toggle styles': {
            '.lego-toggle-row': {
                'display': 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'gap': '14px',
                'margin': '0',
                'font-size': '0.95rem',
                'cursor': 'pointer'
            },
            '.lego-toggle-label': {
                'flex': '1'
            },
            '.lego-toggle-row .lego-toggle, .lego-toggle-row .lego-style-toggle': {
                'flex-shrink': '0',
                'margin': '0'
            },
            '.lego-toggle-hint': {
                'margin': '0 0 14px',
                'font-size': '0.92rem'
            },
            '.lego-toggle': {
                'position': 'relative',
                'display': 'inline-block',
                'width': '48px',
                'height': '24px',
                'margin': '0 10px',
                'vertical-align': 'middle',
                'cursor': 'pointer',
                'flex-shrink': '0'
            },
            '.lego-toggle-input': {
                'opacity': '0',
                'width': '0',
                'height': '0'
            },
            '.lego-toggle-slider': {
                'position': 'absolute',
                'cursor': 'pointer',
                'top': '0',
                'left': '0',
                'right': '0',
                'bottom': '0',
                'transition': 'background-color 0.15s ease, border-color 0.15s ease',
                'border-radius': '24px',
                'box-sizing': 'border-box'
            },
            '.lego-toggle-slider:before': {
                'position': 'absolute',
                'content': '""',
                'height': '18px',
                'width': '18px',
                'left': '3px',
                'bottom': '3px',
                'transition': 'transform 0.15s ease, background-color 0.15s ease',
                'border-radius': '50%'
            },
            '.lego-toggle-input:checked + .lego-toggle-slider:before': {
                'transform': 'translateX(24px)'
            }
        },

        'modal styles': {
            '.lego-modal-container': {
                'position': 'fixed',
                'top': '0',
                'left': '0',
                'width': '100%',
                'height': '100%',
                'display': 'flex',
                'justify-content': 'center',
                'align-items': 'center',
                'z-index': '9999'
            },
            '.lego-modal-content': {
                'padding': '20px',
                'border-radius': '8px',
                'max-width': '500px',
                'width': '90%',
                'max-height': '80%',
                'box-sizing': 'border-box'
            },
            '.lego-modal-header': {
                'display': 'flex',
                'justify-content': 'center',
                'align-items': 'center',
                'margin-bottom': '15px',
                'position': 'relative'
            },
            '.lego-modal-header h3': {
                'margin': '0',
                'text-align': 'center',
                'padding-right': '30px'
            },
            '.lego-modal-header .lego-style-bttnsmall': {
                'position': 'absolute',
                'right': '0',
                'top': '50%',
                'transform': 'translateY(-50%)',
                'margin': '0'
            },
            '.lego-modal-footer': {
                'display': 'flex',
                'justify-content': 'flex-end',
                'margin-top': '15px',
                'gap': '10px'
            }
        },

        'tab styles': {
            '.lego-tabs': {
                'display': 'flex',
                'align-items': 'flex-end',
                'gap': '0',
                'margin-bottom': '0'
            },
            '.lego-tabs-trail': {
                'flex': '1',
                'align-self': 'stretch',
                'min-width': '0'
            },
            '.lego-tab': {
                'position': 'relative',
                'overflow': 'hidden',
                'padding': '10px 16px',
                'background': 'transparent',
                'border': 'none',
                'cursor': 'pointer',
                'font-size': '14px',
                'font-weight': '500',
                'line-height': '1',
                'border-radius': '8px 8px 0 0',
                'transition': 'all 0.2s ease',
                'margin-right': '2px',
                'appearance': 'none'
            },
            '.lego-tab:disabled': {
                'opacity': '0.5',
                'cursor': 'not-allowed'
            },
            '.lego-tab-active': {
                'font-weight': '600'
            },
            '.lego-tab-panel': {
                'border': 'none',
                'border-radius': '0 8px 8px 8px'
            },
            '.lego-tab-content': {
                'padding': '20px'
            }
        },

        'accordion styles': {
            '.lego-accordion': {
                'display': 'flex',
                'flex-direction': 'column',
                'gap': '8px'
            },
            '.lego-accordion-item': {
                'border-radius': '8px',
                'overflow': 'hidden',
                'box-sizing': 'border-box'
            },
            '.lego-accordion-trigger': {
                'display': 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'gap': '12px',
                'width': '100%',
                'padding': '12px 14px',
                'margin': '0',
                'border': 'none',
                'background': 'transparent',
                'cursor': 'pointer',
                'font-size': '14px',
                'font-weight': '600',
                'line-height': '1.3',
                'text-align': 'left',
                'appearance': 'none',
                'box-sizing': 'border-box',
                'position': 'relative',
                'overflow': 'hidden'
            },
            '.lego-accordion-trigger:disabled': {
                'opacity': '0.5',
                'cursor': 'not-allowed'
            },
            '.lego-accordion-trigger::after': {
                'content': '""',
                'flex-shrink': '0',
                'width': '0.45em',
                'height': '0.45em',
                'margin-left': 'auto',
                'border-right': '2px solid currentColor',
                'border-bottom': '2px solid currentColor',
                'transform': 'rotate(-45deg)',
                'transition': 'transform 0.15s ease'
            },
            '.lego-accordion-open > .lego-accordion-trigger::after': {
                'transform': 'rotate(45deg)'
            },
            '.lego-accordion-panel': {
                'padding': '14px',
                'box-sizing': 'border-box'
            }
        },

        'form styles': {
            '.lego-form-grid': {
                'display': 'grid',
                'grid-template-columns': 'minmax(150px, auto) 1fr',
                'gap': '10px',
                'align-items': 'start',
                'margin-bottom': '15px'
            },
            '.lego-form-group': {
                'display': 'contents'
            },
            '.lego-form-label': {
                'padding-top': '8px',
                'justify-self': 'end',
                'font-weight': '500'
            },
            '.lego-input-wrapper': {
                'grid-column': '2'
            },
            '.lego-input': {
                'width': '100%',
                'padding': '8px',
                'border-radius': '4px',
                'font-size': '14px',
                'box-sizing': 'border-box'
            },
            '.lego-input:focus': {
                'outline': 'none',
                'box-shadow': '0 0 0 2px rgba(var(--lego-color-primary-rgb), 0.35)'
            },
            '.lego-full-width': {
                'grid-column': '1 / -1'
            }
        },

        'container styles': {
            '.lego-container': {
                'max-height': '500px',
                'overflow-y': 'auto',
                'padding': '10px'
            },
            '.lego-section': {
                'margin-bottom': '20px',
                'padding': '15px',
                'border-radius': '6px',
                'box-sizing': 'border-box'
            },
            '.lego-section h5': {
                'margin-top': '0',
                'margin-bottom': '12px',
                'font-weight': '500',
                'font-size': '16px'
            },
            '.lego-section:last-child': {
                'margin-bottom': '0'
            },
            '.lego-banner': {
                'margin-bottom': '20px',
                'padding': '15px',
                'border-radius': '6px',
                'box-sizing': 'border-box'
            },
            '.lego-banner h5': {
                'margin-top': '0',
                'margin-bottom': '12px',
                'font-weight': '500',
                'font-size': '16px'
            },
            '.lego-banner:last-child': {
                'margin-bottom': '0'
            },
            '.lego-label': {
                'display': 'block',
                'margin-bottom': '8px',
                'font-weight': '500'
            },
            '.lego-description': {
                'margin-top': '8px',
                'margin-bottom': '4px',
                'font-size': '12px',
                'line-height': '1.4'
            }
        },

        'scrollbar styles': {
            '.lego-scroll::-webkit-scrollbar': {
                'width': '8px'
            },
            '.lego-scroll::-webkit-scrollbar-thumb': {
                'border-radius': '4px'
            }
        },

        'player styles': {
            '.lego-player-audio': {
                'display': 'flex',
                'align-items': 'center',
                'gap': '10px',
                'min-width': '0',
                'min-height': '52px',
                'box-sizing': 'border-box',
                'padding': '8px 12px',
                'border-radius': '10px'
            },
            '.lego-player-video': {
                'display': 'flex',
                'flex-direction': 'column',
                'gap': '10px',
                'min-width': '0',
                'box-sizing': 'border-box',
                'padding': '10px',
                'border-radius': '10px'
            },
            '.lego-player-play': {
                'flex-shrink': '0',
                'width': '32px',
                'height': '32px',
                'border-radius': '999px',
                'border': '1px solid transparent',
                'background': 'transparent',
                'color': 'inherit',
                'font-size': '0.75rem',
                'line-height': '1',
                'padding': '0',
                'cursor': 'pointer',
                'appearance': 'none',
                'box-sizing': 'border-box',
                'display': 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center'
            },
            '.lego-player-wave': {
                'flex': '1',
                'min-width': '0',
                'cursor': 'pointer'
            },
            '.lego-player-wave canvas': {
                'display': 'block',
                'width': '100%',
                'height': '36px'
            },
            '.lego-player-tall .lego-player-wave canvas': {
                'height': '120px'
            },
            '.lego-player-time': {
                'flex-shrink': '0',
                'font-size': '0.78rem',
                'font-variant-numeric': 'tabular-nums',
                'min-width': '72px',
                'text-align': 'right'
            },
            '.lego-player-audio > .lego-player-media': {
                'display': 'none'
            },
            '.lego-player-video > .lego-player-media': {
                'display': 'block',
                'width': '100%',
                'max-height': '320px',
                'border-radius': '6px',
                'background': '#000',
                'object-fit': 'contain'
            },
            '.lego-player-bar': {
                'display': 'flex',
                'align-items': 'center',
                'gap': '10px',
                'min-width': '0'
            },
            '.lego-player-progress': {
                'flex': '1',
                'min-width': '0',
                'height': '6px',
                'border-radius': '999px',
                'cursor': 'pointer',
                'overflow': 'hidden',
                'position': 'relative'
            },
            '.lego-player-progress-fill': {
                'height': '100%',
                'width': '0%',
                'border-radius': '999px',
                'pointer-events': 'none',
                'transition': 'width 0.05s linear'
            }
        },

        'markdown styles': {
            '.lego-markdown': {
                'display': 'block',
                'width': '100%',
                'box-sizing': 'border-box',
                'line-height': '1.55',
                'font-size': '0.95rem'
            },
            '.lego-markdown > :first-child': {
                'margin-top': '0'
            },
            '.lego-markdown > :last-child': {
                'margin-bottom': '0'
            },
            '.lego-markdown h1, .lego-markdown h2, .lego-markdown h3, .lego-markdown h4, .lego-markdown h5, .lego-markdown h6': {
                'line-height': '1.25',
                'font-weight': '600',
                'margin': '1.25em 0 0.5em'
            },
            '.lego-markdown h1': { 'font-size': '1.75rem' },
            '.lego-markdown h2': { 'font-size': '1.4rem' },
            '.lego-markdown h3': { 'font-size': '1.2rem' },
            '.lego-markdown h4': { 'font-size': '1.05rem' },
            '.lego-markdown p, .lego-markdown ul, .lego-markdown ol, .lego-markdown blockquote, .lego-markdown pre, .lego-markdown table': {
                'margin': '0 0 0.9em'
            },
            '.lego-markdown ul, .lego-markdown ol': {
                'padding-left': '1.4em'
            },
            '.lego-markdown li + li': {
                'margin-top': '0.25em'
            },
            '.lego-markdown a': {
                'text-decoration': 'underline',
                'text-underline-offset': '2px'
            },
            '.lego-markdown code': {
                'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                'font-size': '0.88em',
                'padding': '0.12em 0.35em',
                'border-radius': '4px'
            },
            '.lego-markdown pre': {
                'padding': '12px 14px',
                'border-radius': '8px',
                'overflow-x': 'auto'
            },
            '.lego-markdown pre code': {
                'padding': '0',
                'border': 'none',
                'background': 'transparent',
                'font-size': '0.85em'
            },
            '.lego-markdown blockquote': {
                'margin-left': '0',
                'padding': '0.2em 0 0.2em 0.9em'
            },
            '.lego-markdown hr': {
                'border': 'none',
                'border-top': '1px solid',
                'margin': '1.4em 0'
            },
            '.lego-markdown table': {
                'width': '100%',
                'border-collapse': 'collapse',
                'font-size': '0.92em'
            },
            '.lego-markdown th, .lego-markdown td': {
                'border': '1px solid',
                'padding': '6px 10px',
                'text-align': 'left'
            }
        }
    };

    /*------------------------*/
    /*      CSS FUNCTIONS     */
    /*------------------------*/
    
    // HEX TO RGB // Function to convert hex colours in settings to RGB
    function cssHexToRgb(hex) {
        // Remove the # if present
        hex = hex.replace(/^#/, '');

        // Parse the hex values
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return { r, g, b };
    }

    // CSS FROM CONSTANTS // Helper function to convert object to CSS string
    function cssFromConstants(colorConfig, variables = {}) {
        let css = '';

        // Process each section
        for (const [sectionName, section] of Object.entries(colorConfig)) {
            // Add section header
            css += `/* ${sectionName.toUpperCase()} */\n\n`;

            // For each selector in the section
            for (const [selector, properties] of Object.entries(section)) {
                const cssSelector = selector === 'root' ? ':root' : selector;
                css += `${cssSelector} {\n`;

                // Add properties
                for (const [prop, value] of Object.entries(properties)) {
                    // Skip comments (properties that start with //)
                    if (prop.trim().startsWith('//')) continue;

                    // Replace variables in the value
                    let processedValue = value;

                    // Check if the value is a string before trying to replace variables
                    if (typeof processedValue === 'string') {
                        // Replace all ${variableName} occurrences with their values
                        processedValue = processedValue.replace(/\${([^}]+)}/g, (match, varName) => {
                            return variables[varName] || match; // Use the variable value or keep the original if not found
                        });
                    }

                    css += `    ${prop}: ${processedValue};\n`;
                }

                css += '}\n\n';
            }
        }

        return css;
    }

    // LOAD STYLES // Loads CSS for colouring and styling of page elements.
    function cssLoad(primaryColour = '#007bff', secondaryColour = '#17a2b8', darkMode = true, customCSS = {}, reapply = false, options = {}) {
        // Check if our custom styles are already added
        const styleId = '--lego-color-styles';
        const existingStyles = document.querySelectorAll('[data-lego-styles="true"]');

        // If styles exist and we're not reapplying, exit early
        if (existingStyles.length > 0 && !reapply) {
            return;
        }

        // If reapplying and styles exist, remove them first
        if (existingStyles.length > 0 && reapply) {
            existingStyles.forEach(style => style.remove());
        }

        const html = document.documentElement;

        // Set theme based on dark mode parameter
        if (darkMode) {
            html.setAttribute('data-bs-theme', 'dark');
            var contrast = options.contrastColour ?? '#FFFFFF';
            var theme = options.themeColour ?? '#000000';
        } else {
            html.setAttribute('data-bs-theme', 'light');
            var contrast = options.contrastColour ?? '#000000';
            var theme = options.themeColour ?? '#FFFFFF';
        }

        html.setAttribute('data-theme', darkMode ? 'dark' : 'light');
        html.style.colorScheme = darkMode ? 'dark' : 'light';

        var primary = primaryColour;
        var secondary = secondaryColour;

        // Semantic utility colors (fixed values for status indicators)
        var red = "#dc3545";      // Error, urgency
        var yellow = "#ffc107";   // Warning
        var green = "#28a745";    // Positive, success
        var blue = "#0077ff";     // Default blue

        // Convert contrast (hex) to contrastRGB
        var contrastConvert = cssHexToRgb(contrast);
        var contrastRGB = `${contrastConvert.r}, ${contrastConvert.g}, ${contrastConvert.b}`;

        // Convert theme (hex) to themeRGB
        var themeConvert = cssHexToRgb(theme);
        var themeRGB = `${themeConvert.r}, ${themeConvert.g}, ${themeConvert.b}`;

        // Convert primary (hex) to primaryRGB
        var primaryConvert = cssHexToRgb(primary);
        var primaryRGB = `${primaryConvert.r}, ${primaryConvert.g}, ${primaryConvert.b}`;

        // Convert secondary (hex) to secondaryRGB
        var secondaryConvert = cssHexToRgb(secondary);
        var secondaryRGB = `${secondaryConvert.r}, ${secondaryConvert.g}, ${secondaryConvert.b}`;

        // Convert semantic utility colors to RGB
        var redConvert = cssHexToRgb(red);
        var redRGB = `${redConvert.r}, ${redConvert.g}, ${redConvert.b}`;

        var yellowConvert = cssHexToRgb(yellow);
        var yellowRGB = `${yellowConvert.r}, ${yellowConvert.g}, ${yellowConvert.b}`;

        var greenConvert = cssHexToRgb(green);
        var greenRGB = `${greenConvert.r}, ${greenConvert.g}, ${greenConvert.b}`;

        var blueConvert = cssHexToRgb(blue);
        var blueRGB = `${blueConvert.r}, ${blueConvert.g}, ${blueConvert.b}`;

        // Generate default framework CSS
        const colorsDefault = cssFromConstants(legoColors);
        const blocksDefault = cssFromConstants(legoBlocks);

        // Base color variable definitions
        const cssColorVariables = {
            'color variables': {
                'root': {
                    // Base colors
                    '--lego-color-primary': primary,
                    '--lego-color-secondary': secondary,
                    '--lego-color-theme': theme,
                    '--lego-color-contrast': contrast,

                    // RGB values for custom alpha usage
                    '--lego-color-primary-rgb': primaryRGB,
                    '--lego-color-secondary-rgb': secondaryRGB,
                    '--lego-color-theme-rgb': themeRGB,
                    '--lego-color-contrast-rgb': contrastRGB,

                    // Semantic utility colors for status indicators
                    '--lego-color-red': red,
                    '--lego-color-yellow': yellow,
                    '--lego-color-green': green,
                    '--lego-color-blue': blue,

                    // Semantic utility colors RGB values
                    '--lego-color-red-rgb': redRGB,
                    '--lego-color-yellow-rgb': yellowRGB,
                    '--lego-color-green-rgb': greenRGB,
                    '--lego-color-blue-rgb': blueRGB
                }
            }
        };

        const colorVarsCSS = cssFromConstants(cssColorVariables);
        
        // Process custom CSS from the caller
        const customCSSString = customCSS && Object.keys(customCSS).length > 0 
            ? cssFromConstants(customCSS) 
            : '';

        // Combine all styles: framework colors + framework blocks + custom CSS
        let allColors = colorVarsCSS + colorsDefault + blocksDefault + customCSSString;

        console.log('Lego :: Total CSS to apply:', allColors.length, 'characters');

        // Split CSS into chunks to avoid browser limits (10,000 character limit observed)
        // Important: Split at safe boundaries (after closing braces) to avoid breaking CSS rules
        const maxChunkSize = 9000; // Stay safely under the limit
        const cssChunks = [];
        
        let currentPosition = 0;
        while (currentPosition < allColors.length) {
            let chunkEnd = currentPosition + maxChunkSize;
            
            // If we're not at the end of the string, find a safe split point
            if (chunkEnd < allColors.length) {
                // Look backwards from the chunk end to find the last closing brace
                let safeSplitPoint = allColors.lastIndexOf('}', chunkEnd);
                
                // If we found a closing brace, split right after it
                if (safeSplitPoint > currentPosition) {
                    chunkEnd = safeSplitPoint + 1; // +1 to include the closing brace
                } else {
                    // If no closing brace found (shouldn't happen with valid CSS),
                    // try to at least split at a newline
                    const newlineSplit = allColors.lastIndexOf('\n', chunkEnd);
                    if (newlineSplit > currentPosition) {
                        chunkEnd = newlineSplit + 1;
                    }
                    // Otherwise fall back to the original chunkEnd (last resort)
                }
            }
            
            cssChunks.push(allColors.substring(currentPosition, chunkEnd));
            currentPosition = chunkEnd;
        }
        
        console.log('Lego :: Split into', cssChunks.length, 'chunks at safe boundaries');

        // Create multiple style elements if needed
        cssChunks.forEach((chunk, index) => {
            const styleElement = document.createElement('style');
            styleElement.id = `${styleId}-${index}`;
            styleElement.setAttribute('data-lego-styles', 'true');
            styleElement.textContent = chunk;
            document.head.appendChild(styleElement);
            
            // Log chunk details with safety check
            const lastChars = chunk.slice(-20).replace(/\n/g, '\\n');
            console.log(`Lego :: Chunk ${index + 1}/${cssChunks.length}: ${chunk.length} chars, ends with: "${lastChars}"`);
        });

        legoRedrawPlayers();
    }

    /*------------------------*/
    /*     INITIALIZATION     */
    /*------------------------*/

    // INITIALIZE CSS // Main initialization function for the CSS framework
    function legoInitialize(scriptName, site, primaryColour, updatePrimary, secondaryColour, updateSecondary, darkMode, updateDarkMode, customCSS = {}, reapply = false) {
        const LEGOKEY = 'lego-css-settings';
        
        // Default values
        const defaults = {
            primary: '#7700ff',      // Default purple
            secondary: '#17a2b8',    // Secondary accent
            darkMode: true
        };

        console.log(`${scriptName} :: Lego.initialize called for site: ${site}`);

        // Get or create LEGOKEY in localStorage
        let legoSettings;
        try {
            const stored = localStorage.getItem(LEGOKEY);
            legoSettings = stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.error(`${scriptName} :: Error reading LEGOKEY from localStorage:`, e);
            legoSettings = {};
        }

        // Find the most specific matching site
        // More specific sites (longer paths) override less specific ones
        // Supports both subdomain matching (vault.shopify.io matches shopify.io)
        // and path matching (shopify.io/admin matches shopify.io)
        let bestMatch = null;
        let bestMatchLength = 0;
        
        for (const storedSite in legoSettings) {
            let isMatch = false;
            
            // Exact match
            if (site === storedSite) {
                isMatch = true;
            }
            // Current site starts with stored site (path-based: shopify.io/admin starts with shopify.io)
            else if (site.startsWith(storedSite)) {
                isMatch = true;
            }
            // Current site contains stored site for subdomain matching
            // (vault.shopify.io contains shopify.io as a domain part)
            else if (site.includes(storedSite)) {
                // Verify it's a proper domain/path boundary, not just a substring
                const index = site.indexOf(storedSite);
                const charBefore = index > 0 ? site[index - 1] : '';
                const charAfter = site[index + storedSite.length] || '';
                
                // Valid if storedSite is at the start, or preceded by a dot (subdomain)
                // and followed by nothing, a slash (path), or a dot (subdomain continuation)
                if ((index === 0 || charBefore === '.') && 
                    (charAfter === '' || charAfter === '/' || charAfter === '.')) {
                    isMatch = true;
                }
            }
            
            // If this is a match and it's more specific (longer) than previous best match
            if (isMatch && storedSite.length > bestMatchLength) {
                bestMatch = storedSite;
                bestMatchLength = storedSite.length;
            }
        }

        // If we found a match, use it; otherwise use the exact site
        const activeSite = bestMatch || site;
        
        if (bestMatch && bestMatch !== site) {
            console.log(`${scriptName} :: Using settings from '${bestMatch}' for site '${site}'`);
        }

        // Check if site exists in settings, if not create it
        if (!legoSettings[activeSite]) {
            console.log(`${scriptName} :: Site '${activeSite}' not found in LEGOKEY, creating with defaults`);
            legoSettings[activeSite] = {
                primary: primaryColour || defaults.primary,
                secondary: secondaryColour || defaults.secondary,
                darkMode: darkMode !== undefined ? darkMode : defaults.darkMode
            };
        }

        // Load current site settings (from the most specific match)
        let siteSettings = legoSettings[activeSite];

        // If we're updating, update the originally requested site, not the matched one
        // This allows creating more specific overrides
        const isUpdating = updatePrimary || updateSecondary || updateDarkMode;
        
        if (isUpdating) {
            // When updating, work with the exact site requested (allows creating new specific overrides)
            if (!legoSettings[site]) {
                console.log(`${scriptName} :: Creating new settings entry for '${site}'`);
                legoSettings[site] = {
                    primary: primaryColour || siteSettings.primary || defaults.primary,
                    secondary: secondaryColour || siteSettings.secondary || defaults.secondary,
                    darkMode: darkMode !== undefined ? darkMode : (siteSettings.darkMode !== undefined ? siteSettings.darkMode : defaults.darkMode)
                };
            }
            
            // Update the specific site's settings
            if (updatePrimary && primaryColour) {
                console.log(`${scriptName} :: Updating primary colour for '${site}' to ${primaryColour}`);
                legoSettings[site].primary = primaryColour;
            }

            if (updateSecondary && secondaryColour) {
                console.log(`${scriptName} :: Updating secondary colour for '${site}' to ${secondaryColour}`);
                legoSettings[site].secondary = secondaryColour;
            }

            if (updateDarkMode && darkMode !== undefined) {
                console.log(`${scriptName} :: Updating dark mode for '${site}' to ${darkMode}`);
                legoSettings[site].darkMode = darkMode;
            }

            // Save back to localStorage
            try {
                localStorage.setItem(LEGOKEY, JSON.stringify(legoSettings));
                console.log(`${scriptName} :: Settings saved to localStorage`);
            } catch (e) {
                console.error(`${scriptName} :: Error saving to localStorage:`, e);
            }
            
            // Use the updated site's settings for display
            siteSettings = legoSettings[site];
        }

        // Call cssLoad with the settings and custom CSS
        cssLoad(siteSettings.primary, siteSettings.secondary, siteSettings.darkMode, customCSS, reapply);

        return siteSettings;
    }

    /*------------------------*/
    /*    SHOW / HIDE API     */
    /*------------------------*/

    // SHOW // Reveal a content element and hide its siblings within the same container
    function legoShow(contentId) {
        const content = document.getElementById(contentId);
        if (!content) {
            console.warn(`Lego.show :: No element found with id '${contentId}'`);
            return;
        }

        const container = content.parentElement;
        if (!container) {
            console.warn(`Lego.show :: Element '${contentId}' has no parent container`);
            return;
        }

        container.classList.remove('lego-hidden');

        Array.from(container.children).forEach((child) => {
            if (child === content) {
                child.classList.remove('lego-hidden');
            } else {
                child.classList.add('lego-hidden');
            }
        });

        // Sync tab active states when revealing tab content
        const folder = container.closest('.lego-tab-folder');
        if (folder) {
            folder.querySelectorAll('.lego-tab[data-lego-show]').forEach((tab) => {
                const active = tab.getAttribute('data-lego-show') === contentId;
                tab.classList.toggle('lego-tab-active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }
    }

    // HIDE // Hide a container or content element by id
    function legoHide(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Lego.hide :: No element found with id '${id}'`);
            return;
        }

        element.classList.add('lego-hidden');
    }

    function setAccordionItemOpen(item, open) {
        const trigger = item.querySelector('.lego-accordion-trigger');
        const panel = item.querySelector('.lego-accordion-panel');
        if (!trigger || !panel) {
            return;
        }

        item.classList.toggle('lego-accordion-open', open);
        panel.classList.toggle('lego-hidden', !open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // TOGGLE ACCORDION // Expand or collapse an accordion item (trigger, item, panel, or panel id)
    function legoToggleAccordion(target, forceOpen) {
        let item = null;

        if (typeof target === 'string') {
            const byId = document.getElementById(target);
            item = byId?.closest('.lego-accordion-item') || byId;
        } else if (target instanceof Element) {
            item = target.closest('.lego-accordion-item') || target;
        }

        if (!item || !item.classList.contains('lego-accordion-item')) {
            console.warn('Lego.toggleAccordion :: No accordion item found');
            return;
        }

        const accordion = item.closest('.lego-accordion');
        const panel = item.querySelector('.lego-accordion-panel');
        if (!panel) {
            console.warn('Lego.toggleAccordion :: Accordion item is missing a panel');
            return;
        }

        const currentlyOpen = item.classList.contains('lego-accordion-open') && !panel.classList.contains('lego-hidden');
        const willOpen = typeof forceOpen === 'boolean' ? forceOpen : !currentlyOpen;

        if (willOpen && accordion?.classList.contains('lego-accordion-exclusive')) {
            accordion.querySelectorAll('.lego-accordion-item').forEach((other) => {
                if (other !== item) {
                    setAccordionItemOpen(other, false);
                }
            });
        }

        setAccordionItemOpen(item, willOpen);
    }

    // BIND CONTROLS // Wire data-lego-show / data-lego-hide, accordion triggers, and modal chrome once
    let legoControlsBound = false;

    function legoBindControls() {
        if (legoControlsBound || typeof document === 'undefined') {
            return;
        }
        legoControlsBound = true;

        document.addEventListener('click', (event) => {
            const accordionTrigger = event.target.closest('.lego-accordion-trigger');
            if (accordionTrigger) {
                event.preventDefault();
                legoToggleAccordion(accordionTrigger);
                return;
            }

            const showTrigger = event.target.closest('[data-lego-show]');
            if (showTrigger) {
                event.preventDefault();
                legoShow(showTrigger.getAttribute('data-lego-show'));
                return;
            }

            const hideTrigger = event.target.closest('[data-lego-hide]');
            if (hideTrigger) {
                event.preventDefault();
                legoHide(hideTrigger.getAttribute('data-lego-hide'));
                return;
            }

            if (event.target.classList.contains('lego-modal-container') &&
                !event.target.classList.contains('lego-hidden') &&
                event.target.id) {
                legoHide(event.target.id);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }

            document.querySelectorAll('.lego-modal-container:not(.lego-hidden)').forEach((modal) => {
                if (modal.id) {
                    legoHide(modal.id);
                }
            });
        });
    }

    legoBindControls();

    /*------------------------*/
    /*      MEDIA PLAYERS     */
    /*------------------------*/

    const legoAudioPlayers = new Set();
    const legoVideoPlayers = new Set();

    function formatPlayerTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '0:00';
        }
        const totalSec = Math.floor(seconds);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    function getPlayerWaveColors(el) {
        const styles = getComputedStyle(el);
        return {
            wave: styles.getPropertyValue('--lego-player-wave').trim() || 'rgba(119, 0, 255, 0.85)',
            played: styles.getPropertyValue('--lego-player-played').trim() || 'rgba(119, 0, 255, 0.35)',
            scrub: styles.getPropertyValue('--lego-player-scrub').trim() || 'rgba(119, 0, 255, 0.45)'
        };
    }

    function drawPlayerWaveform(canvas, peaks, progress, colors) {
        const wrap = canvas.parentElement;
        const width = wrap?.clientWidth || 320;
        const height = Math.max(Math.floor(wrap?.clientHeight || canvas.clientHeight || 36), 24);
        canvas.width = Math.max(Math.floor(width), 120);
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, height);

        if (!peaks?.length) {
            return;
        }

        const mid = height / 2;
        const progressIndex = Math.floor(progress * peaks.length);

        peaks.forEach((peak, index) => {
            const x = (index / peaks.length) * canvas.width;
            const barW = Math.max(1, canvas.width / peaks.length);
            const top = mid - peak.max * mid * 0.9;
            const bottom = mid - peak.min * mid * 0.9;
            ctx.fillStyle = index <= progressIndex ? colors.played : colors.wave;
            ctx.fillRect(x, top, barW, Math.max(1, bottom - top));
        });

        if (progress > 0 && progress < 1) {
            ctx.strokeStyle = colors.scrub;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(progress * canvas.width, 0);
            ctx.lineTo(progress * canvas.width, height);
            ctx.stroke();
        }
    }

    async function peaksFromArrayBuffer(buffer, sampleCount = 400) {
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
        await audioContext.close();

        const channel = audioBuffer.getChannelData(0);
        const block = Math.floor(channel.length / sampleCount) || 1;
        const peaks = [];
        for (let i = 0; i < sampleCount; i += 1) {
            const start = i * block;
            let min = 1;
            let max = -1;
            for (let j = 0; j < block; j += 1) {
                const value = channel[start + j] ?? 0;
                if (value < min) min = value;
                if (value > max) max = value;
            }
            peaks.push({ min, max });
        }
        return { peaks, duration: audioBuffer.duration };
    }

    async function toggleMediaPlayback(media) {
        if (media.paused) {
            if (media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
                await new Promise((resolve, reject) => {
                    const onReady = () => resolve();
                    const onError = () => reject(new Error('Media failed to load'));
                    media.addEventListener('canplay', onReady, { once: true });
                    media.addEventListener('error', onError, { once: true });
                });
            }
            await media.play();
        } else {
            media.pause();
        }
    }

    function bindPlayButton(playBtn, media) {
        playBtn.addEventListener('click', async () => {
            try {
                await toggleMediaPlayback(media);
            } catch (err) {
                console.warn('Lego.player :: Playback failed:', err.message || err);
            }
        });

        media.addEventListener('play', () => {
            playBtn.textContent = '⏸';
            playBtn.setAttribute('aria-label', 'Pause');
        });
        media.addEventListener('pause', () => {
            playBtn.textContent = '▶';
            playBtn.setAttribute('aria-label', 'Play');
        });
    }

    // MOUNT AUDIO // Wire an audio player shell (play / waveform / time / <audio>)
    async function mountAudioPlayer(root, options = {}) {
        if (!root || root._legoPlayer) {
            return root?._legoPlayer ?? null;
        }

        const audio = root.querySelector('.lego-player-media') || root.querySelector('audio');
        const canvas = root.querySelector('.lego-player-wave canvas');
        const playBtn = root.querySelector('.lego-player-play');
        const timeEl = root.querySelector('.lego-player-time');

        if (!audio || !canvas || !playBtn || !timeEl) {
            console.warn('Lego.mountAudioPlayer :: Missing required child elements');
            return null;
        }

        const player = {
            root,
            audio,
            canvas,
            peaks: options.peaks ?? null,
            duration: 0,
            objectUrl: null,
            redraw() {
                const total = player.duration || audio.duration || 0;
                const current = audio.currentTime || 0;
                timeEl.textContent = `${formatPlayerTime(current)} / ${formatPlayerTime(total)}`;
                drawPlayerWaveform(
                    canvas,
                    player.peaks,
                    total ? current / total : 0,
                    getPlayerWaveColors(root)
                );
            }
        };

        root._legoPlayer = player;
        legoAudioPlayers.add(player);

        bindPlayButton(playBtn, audio);
        audio.addEventListener('timeupdate', () => player.redraw());
        audio.addEventListener('loadedmetadata', () => player.redraw());
        audio.addEventListener('ended', () => player.redraw());

        canvas.addEventListener('click', (event) => {
            const total = player.duration || audio.duration || 0;
            if (!total) return;
            const rect = canvas.getBoundingClientRect();
            const fraction = (event.clientX - rect.left) / rect.width;
            audio.currentTime = Math.max(0, Math.min(total, fraction * total));
            player.redraw();
        });

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => player.redraw());
            observer.observe(canvas.parentElement || root);
            player._resizeObserver = observer;
        }

        const src = options.src || audio.getAttribute('src') || audio.currentSrc;
        if (src && !player.peaks) {
            try {
                const response = await fetch(src);
                if (!response.ok) {
                    throw new Error(`Audio fetch failed (${response.status})`);
                }
                const buffer = await response.arrayBuffer();
                if (!audio.getAttribute('src') && !audio.currentSrc) {
                    const blob = new Blob([buffer], { type: response.headers.get('content-type') || 'audio/mpeg' });
                    player.objectUrl = URL.createObjectURL(blob);
                    audio.src = player.objectUrl;
                    audio.load();
                }
                const decoded = await peaksFromArrayBuffer(buffer, options.sampleCount || 400);
                player.peaks = decoded.peaks;
                player.duration = decoded.duration;
            } catch (err) {
                console.warn('Lego.mountAudioPlayer :: Waveform unavailable:', err.message || err);
            }
        }

        requestAnimationFrame(() => {
            player.redraw();
            requestAnimationFrame(() => player.redraw());
        });

        return player;
    }

    // MOUNT VIDEO // Wire a video player shell (video / play / progress / time)
    function mountVideoPlayer(root, options = {}) {
        if (!root || root._legoPlayer) {
            return root?._legoPlayer ?? null;
        }

        const video = root.querySelector('.lego-player-media') || root.querySelector('video');
        const playBtn = root.querySelector('.lego-player-play');
        const timeEl = root.querySelector('.lego-player-time');
        const progress = root.querySelector('.lego-player-progress');
        const progressFill = root.querySelector('.lego-player-progress-fill');

        if (!video || !playBtn || !timeEl || !progress || !progressFill) {
            console.warn('Lego.mountVideoPlayer :: Missing required child elements');
            return null;
        }

        if (options.src && !video.getAttribute('src') && !video.currentSrc) {
            video.src = options.src;
        }

        const player = {
            root,
            video,
            redraw() {
                const total = video.duration || 0;
                const current = video.currentTime || 0;
                const fraction = total ? current / total : 0;
                timeEl.textContent = `${formatPlayerTime(current)} / ${formatPlayerTime(total)}`;
                progressFill.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
                progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
            }
        };

        root._legoPlayer = player;
        legoVideoPlayers.add(player);

        progress.setAttribute('role', 'slider');
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        progress.setAttribute('aria-valuenow', '0');
        progress.setAttribute('aria-label', 'Seek');

        bindPlayButton(playBtn, video);
        video.addEventListener('timeupdate', () => player.redraw());
        video.addEventListener('loadedmetadata', () => player.redraw());
        video.addEventListener('ended', () => player.redraw());

        const seekFromEvent = (event) => {
            const total = video.duration || 0;
            if (!total) return;
            const rect = progress.getBoundingClientRect();
            const fraction = (event.clientX - rect.left) / rect.width;
            video.currentTime = Math.max(0, Math.min(total, fraction * total));
            player.redraw();
        };

        progress.addEventListener('click', seekFromEvent);

        player.redraw();
        return player;
    }

    function legoRedrawPlayers() {
        legoAudioPlayers.forEach((player) => player.redraw());
        legoVideoPlayers.forEach((player) => player.redraw());
    }

    function legoMountPlayers(scope = document) {
        const roots = scope.querySelectorAll
            ? scope.querySelectorAll('.lego-player-audio, .lego-player-video')
            : [];
        roots.forEach((root) => {
            if (root.classList.contains('lego-player-audio')) {
                void mountAudioPlayer(root);
            } else if (root.classList.contains('lego-player-video')) {
                mountVideoPlayer(root);
            }
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                legoMountPlayers();
                legoMountMarkdowns();
            });
        } else {
            legoMountPlayers();
            legoMountMarkdowns();
        }
    }

    /*------------------------*/
    /*        MARKDOWN        */
    /*------------------------*/

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderMarkdownInline(text) {
        let html = escapeHtml(text);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
            const safeHref = String(href).replace(/"/g, '');
            if (/^\s*javascript:/i.test(safeHref)) {
                return escapeHtml(label);
            }
            return `<a href="${safeHref}">${label}</a>`;
        });
        return html;
    }

    function isTableSeparator(line) {
        return /^\|?[\s:|-]+\|[\s:|-]+\|?$/.test(line.trim()) && /-/.test(line);
    }

    function splitTableRow(line) {
        const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((cell) => cell.trim());
    }

    // RENDER MARKDOWN // Convert a CommonMark-ish subset to safe HTML
    function renderMarkdown(source) {
        const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
        const html = [];
        let i = 0;
        let paragraph = [];
        let listType = null;
        let listItems = [];

        const flushParagraph = () => {
            if (!paragraph.length) return;
            html.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`);
            paragraph = [];
        };

        const flushList = () => {
            if (!listType) return;
            const tag = listType;
            html.push(`<${tag}>${listItems.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join('')}</${tag}>`);
            listType = null;
            listItems = [];
        };

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                flushParagraph();
                flushList();
                i += 1;
                continue;
            }

            if (trimmed.startsWith('```')) {
                flushParagraph();
                flushList();
                const fence = [];
                i += 1;
                while (i < lines.length && !lines[i].trim().startsWith('```')) {
                    fence.push(lines[i]);
                    i += 1;
                }
                html.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
                if (i < lines.length) i += 1;
                continue;
            }

            const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                flushList();
                const level = heading[1].length;
                html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
                i += 1;
                continue;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushParagraph();
                flushList();
                html.push('<hr>');
                i += 1;
                continue;
            }

            if (trimmed.startsWith('>')) {
                flushParagraph();
                flushList();
                const quote = [];
                while (i < lines.length && lines[i].trim().startsWith('>')) {
                    quote.push(lines[i].trim().replace(/^>\s?/, ''));
                    i += 1;
                }
                html.push(`<blockquote><p>${renderMarkdownInline(quote.join(' '))}</p></blockquote>`);
                continue;
            }

            const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
            if (unordered) {
                flushParagraph();
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(unordered[1]);
                i += 1;
                continue;
            }

            const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
            if (ordered) {
                flushParagraph();
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push(ordered[1]);
                i += 1;
                continue;
            }

            if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
                flushParagraph();
                flushList();
                const header = splitTableRow(trimmed);
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                    rows.push(splitTableRow(lines[i]));
                    i += 1;
                }
                html.push('<table><thead><tr>' +
                    header.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join('') +
                    '</tr></thead><tbody>' +
                    rows.map((row) => `<tr>${row.map((cell) => `<td>${renderMarkdownInline(cell)}</td>`).join('')}</tr>`).join('') +
                    '</tbody></table>');
                continue;
            }

            flushList();
            paragraph.push(trimmed);
            i += 1;
        }

        flushParagraph();
        flushList();
        return html.join('\n');
    }

    // MOUNT MARKDOWN // Render markdown text or fetch from data-lego-src / options.src
    async function mountMarkdown(root, options = {}) {
        if (!root) {
            return null;
        }

        const src = options.src || root.getAttribute('data-lego-src');
        let markdown = options.markdown;

        if (markdown == null && src) {
            try {
                const response = await fetch(src);
                if (!response.ok) {
                    throw new Error(`Markdown fetch failed (${response.status})`);
                }
                markdown = await response.text();
            } catch (err) {
                root.innerHTML = `<p>${escapeHtml(err.message || String(err))}</p>`;
                console.warn('Lego.mountMarkdown ::', err.message || err);
                return null;
            }
        }

        if (markdown == null) {
            markdown = root.getAttribute('data-lego-markdown') || root.textContent || '';
        }

        root.innerHTML = renderMarkdown(markdown);
        root.classList.add('lego-markdown');
        return root;
    }

    function legoMountMarkdowns(scope = document) {
        const targets = scope.querySelectorAll
            ? scope.querySelectorAll('.lego-markdown[data-lego-src], [data-lego-markdown]')
            : [];
        targets.forEach((root) => {
            void mountMarkdown(root);
        });
    }

    /*------------------------*/
    /*         EXPORTS        */
    /*------------------------*/

    // Public API
    return {
        // Constants
        colors: legoColors,
        blocks: legoBlocks,
        
        // Functions
        initialize: legoInitialize,
        load: cssLoad,
        hexToRgb: cssHexToRgb,
        fromConstants: cssFromConstants,
        show: legoShow,
        hide: legoHide,
        toggleAccordion: legoToggleAccordion,
        mountAudioPlayer,
        mountVideoPlayer,
        mountPlayers: legoMountPlayers,
        redrawPlayers: legoRedrawPlayers,
        renderMarkdown,
        mountMarkdown,
        mountMarkdowns: legoMountMarkdowns
    };

})();

export default Lego;

if (typeof window !== 'undefined') {
    window.Lego = Lego;
}

