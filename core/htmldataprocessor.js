﻿/**
 * @license Copyright (c) 2003-2013, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.html or http://ckeditor.com/license
 */

(function() {
	/**
	 * Represents an HTML data processor, which is responsible to translate and
	 * transform the editor data on input and output.
	 *
	 * @class
	 * @extends CKEDITOR.dataProcessor
	 * @constructor Creates a htmlDataProcessor class instance.
	 * @param {CKEDITOR.editor} editor
	 */
	CKEDITOR.htmlDataProcessor = function( editor ) {
		var dataFilter, htmlFilter;

		this.editor = editor;

		this.dataFilter = dataFilter = new CKEDITOR.htmlParser.filter();
		this.htmlFilter = htmlFilter = new CKEDITOR.htmlParser.filter();

		/**
		 * The HTML writer used by this data processor to format the output.
		 * @type {CKEDITOR.htmlParser.basicWriter}
		 */
		this.writer = new CKEDITOR.htmlParser.basicWriter();

		dataFilter.addRules( defaultDataFilterRules );
		dataFilter.addRules( createBogusAndFillerRules( editor, 'data' ) );
		htmlFilter.addRules( defaultHtmlFilterRules );
		htmlFilter.addRules( createBogusAndFillerRules( editor, 'html' ) );
	};

	CKEDITOR.htmlDataProcessor.prototype = {
		/**
		 * Process the input (potentially malformed) HTML to a purified form which
		 * is suitable to be used in the wysiwyg editable.
		 *
		 * @param {String} data The raw data.
		 * @param {String} [options] The options object.
		 * @param {String} [options.context] The tag name of a context element within which
		 * the input is to be processed, default to be the editable element.
		 * @param {Boolean} [options.fixForBody=true] Whether to trigger the auto paragraph for non-block contents.
		 * @returns {String}
		 */
		toHtml: function( data, options, fixForBody ) {

			// The source data is already HTML, but we need to clean
			// it up and apply the filter.

			data = protectSource( data, this.editor );

			// Before anything, we must protect the URL attributes as the
			// browser may changing them when setting the innerHTML later in
			// the code.
			data = protectAttributes( data );

			// Protect elements than can't be set inside a DIV. E.g. IE removes
			// style tags from innerHTML. (#3710)
			data = protectElements( data );

			// Certain elements has problem to go through DOM operation, protect
			// them by prefixing 'cke' namespace. (#3591)
			data = protectElementsNames( data );

			// All none-IE browsers ignore self-closed custom elements,
			// protecting them into open-close. (#3591)
			data = protectSelfClosingElements( data );

			// Compensate one leading line break after <pre> open as browsers
			// eat it up. (#5789)
			data = protectPreFormatted( data );

			var editable = this.editor.editable(),
				isPre,
				context;

			// Typeof null == 'object', so check truthiness of options too.
			if ( options && typeof options == 'object' ) {
				context = options.context;
				fixForBody = options.fixForBody;
			}
			// Backward compatibility. Since CKEDITOR 4.0 every option was a separate argument.
			else
				context = options;

			// Fall back to the editable as context if not specified.
			if ( !context && context !== null )
				context = editable.getName();

			var fixBin = context || editable.getName();

			// Old IEs loose formats when load html into <pre>.
			if ( CKEDITOR.env.ie && CKEDITOR.env.version < 9 && fixBin == 'pre' ) {
				fixBin = 'div';
				data = '<pre>' + data + '</pre>';
				isPre = 1;
			}

			// Call the browser to help us fixing a possibly invalid HTML
			// structure.
			var el = this.editor.document.createElement( fixBin );
			// Add fake character to workaround IE comments bug. (#3801)
			el.setHtml( 'a' + data );
			data = el.getHtml().substr( 1 );

			// Restore shortly protected attribute names.
			data = data.replace( new RegExp( ' data-cke-' + CKEDITOR.rnd + '-', 'ig' ), ' ' );

			isPre && ( data = data.replace( /^<pre>|<\/pre>$/gi, '' ) );

			// Unprotect "some" of the protected elements at this point.
			data = unprotectElementNames( data );

			data = unprotectElements( data );

			// Restore the comments that have been protected, in this way they
			// can be properly filtered.
			data = unprotectRealComments( data );

			// Now use our parser to make further fixes to the structure, as
			// well as apply the filter.
			var fragment = CKEDITOR.htmlParser.fragment.fromHtml( data, context, fixForBody === false ? false : getFixBodyTag( this.editor.config ) );

			var writer = new CKEDITOR.htmlParser.basicWriter();

			fragment.writeChildrenHtml( writer, this.dataFilter, 1 );
			data = writer.getHtml( true );

			// Protect the real comments again.
			data = protectRealComments( data );

			return data;
		},

		/**
		 * See {@link CKEDITOR.dataProcessor#toDataFormat}.
		 *
		 * @param {String} html
		 * @returns {String}
		 */
		toDataFormat: function( html ) {
			// The parent element will always be the editable.
			var editable = this.editor.editable(),
				writer = this.writer;

			var fragment = CKEDITOR.htmlParser.fragment.fromHtml( html, editable.getName(), getFixBodyTag( this.editor.config ) );

			writer.reset();

			fragment.writeChildrenHtml( writer, this.htmlFilter, 1 );

			var data = writer.getHtml( true );

			// Restore those non-HTML protected source. (#4475,#4880)
			data = unprotectRealComments( data );
			data = unprotectSource( data, this.editor );

			return data;
		}
	};

	// Produce a set of filtering rules that handles bogus and filler node at the
	// end of block/pseudo block, in the following consequence:
	// 1. elements:<block> - this filter removes any bogus node, then check
	// if it's an empty block that requires a filler.
	// 2. elements:<br> - After cleaned with bogus, this filter checks the real
	// line-break BR to compensate a filler after it.
	//
	// Terms definitions:
	// filler: An element that's either <BR> or &NBSP; at the end of block that established line height.
	// bogus: Whenever a filler is proceeded with inline content, it becomes a bogus which is subjected to be removed.
	//
	// Various forms of the filler:
	// In output HTML: Filler should be consistently &NBSP; <BR> at the end of block is always considered as bogus.
	// In Wysiwyg HTML: Browser dependent - see env.needsBrFiller. Either BR for when needsBrFiller is true, or &NBSP; otherwise.
	// <BR> is NEVER considered as bogus when needsBrFiller is true.
	function createBogusAndFillerRules( editor, type ) {
		function createFiller( isOutput ) {
			return isOutput || CKEDITOR.env.needsNbspFiller ?
				new CKEDITOR.htmlParser.text( '\xa0' ) :
				new CKEDITOR.htmlParser.element( 'br', { 'data-cke-bogus': 1 } );
		}

		// This text block filter, remove any bogus and create the filler on demand.
		function blockFilter( isOutput, fillEmptyBlock ) {

			return function( block ) {

				// DO NOT apply the filer if it's a fragment node.
				if ( block.type == CKEDITOR.NODE_DOCUMENT_FRAGMENT )
					return;

				cleanBogus( block );

				// [Opera] it's mandatory for the filler to present inside of empty block when in WYSIWYG.
				if ( ( ( CKEDITOR.env.opera && !isOutput ) ||
						( typeof fillEmptyBlock == 'function' ? fillEmptyBlock( block ) !== false : fillEmptyBlock ) ) &&
						 isEmptyBlockNeedFiller( block ) )
				{
					block.add( createFiller( isOutput ) );
				}
			};
		}

		// Append a filler right after the last line-break BR, found at the end of block.
		function brFilter( isOutput ) {
			return function ( br ) {

				// DO NOT apply the filer if parent's a fragment node.
				if ( br.parent.type == CKEDITOR.NODE_DOCUMENT_FRAGMENT )
					return;

				var attrs = br.attributes;
				// Dismiss BRs that are either bogus or eol marker.
				if ( 'data-cke-bogus' in attrs ||
						 'data-cke-eol' in attrs ) {
					delete attrs [ 'data-cke-bogus' ];
					return;
				}

				// Judge the tail line-break BR, and to insert bogus after it.
				var next = getNext( br ), previous = getPrevious( br );

				if ( !next && isBlockBoundary( br.parent ) )
					append( br.parent, createFiller( isOutput ) );
				else if ( isBlockBoundary( next ) && previous && !isBlockBoundary( previous ) ) {
					insertBefore( next, createFiller( isOutput ) );
				}
			};
		}

		// Determinate whether this node is potentially a bogus node.
		function maybeBogus( node, atBlockEnd ) {

			// BR that's not from IE<11 DOM, except for a EOL marker.
			if ( !( isOutput && !CKEDITOR.env.needsBrFiller ) &&
					 node.type == CKEDITOR.NODE_ELEMENT && node.name == 'br' &&
					 !node.attributes[ 'data-cke-eol' ] )
				return true;

			var match;
			// NBSP, possibly.
			if ( node.type == CKEDITOR.NODE_TEXT &&
					 ( match = node.value.match( tailNbspRegex ) ) )
			{
				// We need to separate tail NBSP out of a text node, for later removal.
				if ( match.index ) {
					insertBefore( node, new CKEDITOR.htmlParser.text( node.value.substring( 0, match.index ) ) );
					node.value = match[ 0 ];
				}

				// From IE<11 DOM, at the end of a text block, or before block boundary.
				if ( !CKEDITOR.env.needsBrFiller && isOutput && ( !atBlockEnd || node.parent.name in textBlockTags ) )
					return true;

				// From the output.
				if ( !isOutput ) {
					var previous = node.previous;

					// Following a line-break at the end of block.
					if ( previous && previous.name == 'br' )
						return true;

					// Or a single NBSP between two blocks.
					if ( !previous || isBlockBoundary( previous ) )
						return true;
				}
			}

			return false;
		}

		// Removes all bogus inside of this block, and to convert fillers into the proper form.
		function cleanBogus( block ) {
			var bogus = [];
			var last = getLast( block ), node, previous;
			if ( last ) {

				// Check for bogus at the end of this block.
				// e.g. <p>foo<br /></p>
				maybeBogus( last, 1 ) && bogus.push( last );

				while ( last ) {

					// Check for bogus at the end of any pseudo block contained.
					if ( isBlockBoundary( last ) &&
							 ( node = getPrevious( last ) ) &&
							 maybeBogus( node ) )
					{
						// Bogus must have inline proceeding, instead single BR between two blocks,
						// is considered as filler, e.g. <hr /><br /><hr />
						if ( ( previous = getPrevious( node ) ) && !isBlockBoundary( previous ) )
							bogus.push( node );
						// Convert the filler into appropriate form.
						else {
							insertAfter( node, createFiller( isOutput ) );
							removeFromParent( node );
						}
					}

					last = last.previous;
				}
			}

			// Now remove all bogus collected from above.
			for ( var i = 0 ; i < bogus.length ; i++ )
				removeFromParent( bogus[ i ] );
		}

		// Judge whether it's an empty block that requires a filler node.
		function isEmptyBlockNeedFiller( block ) {

			// DO NOT fill empty editable in IE<11.
			if ( !isOutput && !CKEDITOR.env.needsBrFiller && block.type == CKEDITOR.NODE_DOCUMENT_FRAGMENT )
				return false;

			// 1. For IE version >=8,  empty blocks are displayed correctly themself in wysiwiyg;
			// 2. For the rest, at least table cell and list item need no filler space. (#6248)
			if ( !isOutput && !CKEDITOR.env.needsBrFiller &&
					 ( document.documentMode > 7 ||
						 block.name in CKEDITOR.dtd.tr ||
						 block.name in CKEDITOR.dtd.$listItem ) ) {
				return false;
			}

			var last = getLast( block );
			return !last || block.name == 'form' && last.name == 'input' ;
		}

		var rules = { elements: {} };
		var isOutput = type == 'html';

		// Build the list of text blocks.
		var textBlockTags = CKEDITOR.tools.extend( {}, blockLikeTags );
		for ( var i in textBlockTags ) {
			if ( !( '#' in dtd[ i ] ) )
				delete textBlockTags[ i ];
		}

		for ( i in textBlockTags )
			rules.elements[ i ] = blockFilter( isOutput, editor.config.fillEmptyBlocks !== false );

		// Editable element is to be checked separately.
		rules.root = blockFilter( isOutput );
		rules.elements.br = brFilter( isOutput );
		return rules;
	}

	function getFixBodyTag( config ) {
		return ( config.enterMode != CKEDITOR.ENTER_BR && config.autoParagraph !== false ) ? config.enterMode == CKEDITOR.ENTER_DIV ? 'div' : 'p' : false;
	}

	// Regex to scan for &nbsp; at the end of blocks, which are actually placeholders.
	// Safari transforms the &nbsp; to \xa0. (#4172)
	var tailNbspRegex = /(?:&nbsp;|\xa0)$/;

	var protectedSourceMarker = '{cke_protected}';

	function getLast( node ) {
		var last = node.children[ node.children.length - 1 ];
		while ( last && isEmpty( last ) )
			last = last.previous;
		return last;
	}

	function getNext( node ) {
		var next = node.next;
		while ( next && isEmpty( next ) )
			next = next.next;
		return next;
	}

	function getPrevious( node ) {
		var previous = node.previous;
		while ( previous && isEmpty( previous ) )
			previous = previous.previous;
		return previous;
	}

	// Judge whether the node is an ghost node to be ignored, when traversing.
	function isEmpty( node ) {
		return node.type == CKEDITOR.NODE_TEXT &&
		  !CKEDITOR.tools.trim( node.value ) ||
		  node.type == CKEDITOR.NODE_ELEMENT &&
		  node.attributes[ 'data-cke-bookmark' ];
	}

	// Judge whether the node is a block-like element.
	function isBlockBoundary( node ) {
		return node &&
					 ( node.type == CKEDITOR.NODE_ELEMENT && node.name in blockLikeTags ||
						 node.type == CKEDITOR.NODE_DOCUMENT_FRAGMENT );
	}

	function insertAfter( node, insertion ) {
		var children = node.parent.children;
		var index = CKEDITOR.tools.indexOf( children, node );
		children.splice( index + 1, 0, insertion );
		var next = node.next;
		node.next = insertion;
		insertion.previous = node;
		insertion.parent = node.parent;
		insertion.next = next;
	}

	function insertBefore( node, insertion ) {
		var children = node.parent.children;
		var index = CKEDITOR.tools.indexOf( children, node );
		children.splice( index, 0, insertion );
		var prev = node.previous;
		node.previous = insertion;
		insertion.next = node;
		insertion.parent = node.parent;
		if ( prev ) {
			insertion.previous = prev;
			prev.next = insertion;
		}
	}

	function append( parent, node ) {
		var last = parent.children[ parent.children.length -1 ];
		parent.children.push( node );
		node.parent = parent;
		if ( last ) {
			last.next = node;
			node.previous = last;
		}
	}

	function removeFromParent( node ) {
		var children = node.parent.children;
		var index = CKEDITOR.tools.indexOf( children, node );
		var previous = node.previous, next = node.next;
		previous && ( previous.next = next );
		next && ( next.previous = previous );
		children.splice( index, 1 );
	}

	function getNodeIndex( node ) {
		var parent = node.parent;
		return parent ? CKEDITOR.tools.indexOf( parent.children, node ) : -1;
	}

	var dtd = CKEDITOR.dtd;

	// Define orders of table elements.
	var tableOrder = [ 'caption', 'colgroup', 'col', 'thead', 'tfoot', 'tbody' ];

	// List of all block elements.
	var blockLikeTags = CKEDITOR.tools.extend( {}, dtd.$blockLimit, dtd.$block );

	var defaultDataFilterRules = {
		elements: {},
		attributeNames: [
			// Event attributes (onXYZ) must not be directly set. They can become
			// active in the editing area (IE|WebKit).
			[ ( /^on/ ), 'data-cke-pa-on' ]
		]
	};

	var defaultHtmlFilterRules = {
		elementNames: [
			// Remove the "cke:" namespace prefix.
			[ ( /^cke:/ ), '' ],

			// Ignore <?xml:namespace> tags.
			[ ( /^\?xml:namespace$/ ), '' ]
		],

		attributeNames: [
			// Attributes saved for changes and protected attributes.
			[ ( /^data-cke-(saved|pa)-/ ), '' ],

			// All "data-cke-" attributes are to be ignored.
			[ ( /^data-cke-.*/ ), '' ],

			[ 'hidefocus', '' ]
		],

		elements: {
			$: function( element ) {
				var attribs = element.attributes;

				if ( attribs ) {
					// Elements marked as temporary are to be ignored.
					if ( attribs[ 'data-cke-temp' ] )
						return false;

					// Remove duplicated attributes - #3789.
					var attributeNames = [ 'name', 'href', 'src' ],
						savedAttributeName;
					for ( var i = 0; i < attributeNames.length; i++ ) {
						savedAttributeName = 'data-cke-saved-' + attributeNames[ i ];
						savedAttributeName in attribs && ( delete attribs[ attributeNames[ i ] ] );
					}
				}

				return element;
			},

			// The contents of table should be in correct order (#4809).
			table: function( element ) {
					// Clone the array as it would become empty during the sort call.
					var children = element.children.slice( 0 );
					children.sort( function ( node1, node2 ) {
						var index1, index2;

						// Compare in the predefined order.
						if ( node1.type == CKEDITOR.NODE_ELEMENT &&
								 node2.type == node1.type ) {
							index1 = CKEDITOR.tools.indexOf( tableOrder, node1.name );
							index2 = CKEDITOR.tools.indexOf( tableOrder, node2.name );
						}

						// Make sure the sort is stable, if no order can be established above.
						if ( !( index1 > -1 && index2 > -1 && index1 != index2 ) ) {
							index1 = getNodeIndex( node1 );
							index2 = getNodeIndex( node2 );
						}

						return index1 > index2 ? 1 : -1;
					});
			},

			embed: function( element ) {
				var parent = element.parent;

				// If the <embed> is child of a <object>, copy the width
				// and height attributes from it.
				if ( parent && parent.name == 'object' ) {
					var parentWidth = parent.attributes.width,
						parentHeight = parent.attributes.height;
					parentWidth && ( element.attributes.width = parentWidth );
					parentHeight && ( element.attributes.height = parentHeight );
				}
			},
			// Restore param elements into self-closing.
			param: function( param ) {
				param.children = [];
				param.isEmpty = true;
				return param;
			},

			// Remove empty link but not empty anchor.(#3829)
			a: function( element ) {
				if ( !( element.children.length || element.attributes.name || element.attributes[ 'data-cke-saved-name' ] ) ) {
					return false;
				}
			},

			// Remove dummy span in webkit.
			span: function( element ) {
				if ( element.attributes[ 'class' ] == 'Apple-style-span' )
					delete element.name;
			},

			html: function( element ) {
				delete element.attributes.contenteditable;
				delete element.attributes[ 'class' ];
			},

			body: function( element ) {
				delete element.attributes.spellcheck;
				delete element.attributes.contenteditable;
			},

			style: function( element ) {
				var child = element.children[ 0 ];
				child && child.value && ( child.value = CKEDITOR.tools.trim( child.value ) );

				if ( !element.attributes.type )
					element.attributes.type = 'text/css';
			},

			title: function( element ) {
				var titleText = element.children[ 0 ];

				// Append text-node to title tag if not present (i.e. non-IEs) (#9882).
				!titleText && append( element, titleText = new CKEDITOR.htmlParser.text() );

				// Transfer data-saved title to title tag.
				titleText.value = element.attributes[ 'data-cke-title' ] || '';
			}
		},

		attributes: {
			'class': function( value, element ) {
				// Remove all class names starting with "cke_".
				return CKEDITOR.tools.ltrim( value.replace( /(?:^|\s+)cke_[^\s]*/g, '' ) ) || false;
			}
		}
	};

	if ( CKEDITOR.env.ie ) {
		// IE outputs style attribute in capital letters. We should convert
		// them back to lower case, while not hurting the values (#5930)
		defaultHtmlFilterRules.attributes.style = function( value, element ) {
			return value.replace( /(^|;)([^\:]+)/g, function( match ) {
				return match.toLowerCase();
			});
		};
	}

	function protectReadOnly( element ) {
		var attrs = element.attributes;

		// We should flag that the element was locked by our code so
		// it'll be editable by the editor functions (#6046).
		if ( attrs.contenteditable != "false" )
			attrs[ 'data-cke-editable' ] = attrs.contenteditable ? 'true' : 1;

		attrs.contenteditable = "false";
	}

	function unprotectReadyOnly( element ) {
		var attrs = element.attributes;
		switch ( attrs[ 'data-cke-editable' ] ) {
			case 'true':
				attrs.contenteditable = 'true';
				break;
			case '1':
				delete attrs.contenteditable;
				break;
		}
	}
	// Disable form elements editing mode provided by some browers. (#5746)
	for ( var i in { input:1,textarea:1 } ) {
		defaultDataFilterRules.elements[ i ] = protectReadOnly;
		defaultHtmlFilterRules.elements[ i ] = unprotectReadyOnly;
	}

	var protectElementRegex = /<(a|area|img|input|source)\b([^>]*)>/gi,
		protectAttributeRegex = /\b(on\w+|href|src|name)\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|(?:[^ "'>]+))/gi;

	var protectElementsRegex = /(?:<style(?=[ >])[^>]*>[\s\S]*<\/style>)|(?:<(:?link|meta|base)[^>]*>)/gi,
		encodedElementsRegex = /<cke:encoded>([^<]*)<\/cke:encoded>/gi;

	var protectElementNamesRegex = /(<\/?)((?:object|embed|param|html|body|head|title)[^>]*>)/gi,
		unprotectElementNamesRegex = /(<\/?)cke:((?:html|body|head|title)[^>]*>)/gi;

	var protectSelfClosingRegex = /<cke:(param|embed)([^>]*?)\/?>(?!\s*<\/cke:\1)/gi;

	function protectAttributes( html ) {
		return html.replace( protectElementRegex, function( element, tag, attributes ) {
			return '<' + tag + attributes.replace( protectAttributeRegex, function( fullAttr, attrName ) {
				// Avoid corrupting the inline event attributes (#7243).
				// We should not rewrite the existed protected attributes, e.g. clipboard content from editor. (#5218)
				if ( !( /^on/ ).test( attrName ) && attributes.indexOf( 'data-cke-saved-' + attrName ) == -1 )
					return ' data-cke-saved-' + fullAttr + ' data-cke-' + CKEDITOR.rnd + '-' + fullAttr;

				return fullAttr;
			}) + '>';
		});
	}

	function protectElements( html ) {
		return html.replace( protectElementsRegex, function( match ) {
			return '<cke:encoded>' + encodeURIComponent( match ) + '</cke:encoded>';
		});
	}

	function unprotectElements( html ) {
		return html.replace( encodedElementsRegex, function( match, encoded ) {
			return decodeURIComponent( encoded );
		});
	}

	function protectElementsNames( html ) {
		return html.replace( protectElementNamesRegex, '$1cke:$2' );
	}

	function unprotectElementNames( html ) {
		return html.replace( unprotectElementNamesRegex, '$1$2' );
	}

	function protectSelfClosingElements( html ) {
		return html.replace( protectSelfClosingRegex, '<cke:$1$2></cke:$1>' );
	}

	function protectPreFormatted( html ) {
		return CKEDITOR.env.opera ? html : html.replace( /(<pre\b[^>]*>)(\r\n|\n)/g, '$1$2$2' );
	}

	function protectRealComments( html ) {
		return html.replace( /<!--(?!{cke_protected})[\s\S]+?-->/g, function( match ) {
			return '<!--' + protectedSourceMarker +
				'{C}' +
				encodeURIComponent( match ).replace( /--/g, '%2D%2D' ) +
				'-->';
		});
	}

	function unprotectRealComments( html ) {
		return html.replace( /<!--\{cke_protected\}\{C\}([\s\S]+?)-->/g, function( match, data ) {
			return decodeURIComponent( data );
		});
	}

	function unprotectSource( html, editor ) {
		var store = editor._.dataStore;

		return html.replace( /<!--\{cke_protected\}([\s\S]+?)-->/g, function( match, data ) {
			return decodeURIComponent( data );
		}).replace( /\{cke_protected_(\d+)\}/g, function( match, id ) {
			return store && store[ id ] || '';
		});
	}

	function protectSource( data, editor ) {
		var protectedHtml = [],
			protectRegexes = editor.config.protectedSource,
			store = editor._.dataStore || ( editor._.dataStore = { id:1 } ),
			tempRegex = /<\!--\{cke_temp(comment)?\}(\d*?)-->/g;

		var regexes = [
			// Script tags will also be forced to be protected, otherwise
			// IE will execute them.
			( /<script[\s\S]*?<\/script>/gi ),

			// <noscript> tags (get lost in IE and messed up in FF).
			/<noscript[\s\S]*?<\/noscript>/gi
		].concat( protectRegexes );

		// First of any other protection, we must protect all comments
		// to avoid loosing them (of course, IE related).
		// Note that we use a different tag for comments, as we need to
		// transform them when applying filters.
		data = data.replace( ( /<!--[\s\S]*?-->/g ), function( match ) {
			return '<!--{cke_tempcomment}' + ( protectedHtml.push( match ) - 1 ) + '-->';
		});

		for ( var i = 0; i < regexes.length; i++ ) {
			data = data.replace( regexes[ i ], function( match ) {
				match = match.replace( tempRegex, // There could be protected source inside another one. (#3869).
				function( $, isComment, id ) {
					return protectedHtml[ id ];
				});

				// Avoid protecting over protected, e.g. /\{.*?\}/
				return ( /cke_temp(comment)?/ ).test( match ) ? match : '<!--{cke_temp}' + ( protectedHtml.push( match ) - 1 ) + '-->';
			});
		}
		data = data.replace( tempRegex, function( $, isComment, id ) {
			return '<!--' + protectedSourceMarker +
				( isComment ? '{C}' : '' ) +
				encodeURIComponent( protectedHtml[ id ] ).replace( /--/g, '%2D%2D' ) +
				'-->';
		});

		// Different protection pattern is used for those that
		// live in attributes to avoid from being HTML encoded.
		return data.replace( /(['"]).*?\1/g, function( match ) {
			return match.replace( /<!--\{cke_protected\}([\s\S]+?)-->/g, function( match, data ) {
				store[ store.id ] = decodeURIComponent( data );
				return '{cke_protected_' + ( store.id++ ) + '}';
			});
		});
	}
})();

/**
 * Whether a filler text (non-breaking space entity - `&nbsp;`) will be
 * inserted into empty block elements in HTML output,
 * this is used to render block elements properly with `line-height`
 * When a function is instead specified, it'll be passed a {@link CKEDITOR.htmlParser.element}
 * to decide whether adding the filler text by expecting a boolean return value.
 *
 *		config.fillEmptyBlocks = false; // Prevent filler nodes in all empty blocks.
 *
 *		// Prevent filler node only in float cleaners.
 *		config.fillEmptyBlocks = function( element ) {
 *			if ( element.attributes[ 'class' ].indexOf( 'clear-both' ) != -1 )
 *				return false;
 *		};
 *
 * @since 3.5
 * @cfg {Boolean} [fillEmptyBlocks=true]
 * @member CKEDITOR.config
 */
