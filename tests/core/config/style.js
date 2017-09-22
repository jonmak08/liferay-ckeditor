/* bender-tags: editor,unit */

( function() {
bender.test( {
	'test disableReadonlyStyling=true': function() {
		bender.editorBot.create(
			{
				name: 'test_dRS_true',
				startupData: '<p>Text <span contenteditable=false id="marker1">text</span> text.</p>',
				config: {
					disableReadonlyStyling: true,
					allowedContent: true // Disable filter.
				}
			},
			function( bot ) {
				var editor = bot.editor,
					range = editor.createRange(),
					style = new CKEDITOR.style( { name: 'Bold', element: 'b' } );

				range.selectNodeContents( editor.editable() );
				editor.getSelection().selectRanges( [ range ] );
				editor.applyStyle( style );

				assert.isFalse( editor.document.getById( 'marker1' ).hasAscendant( 'b' ) );
			}
		);
	},

	'test disableReadonlyStyling=false': function() {
		bender.editorBot.create(
			{
				name: 'test_dRS_false',
				startupData: '<p>Text <span contenteditable=false id="marker2">text</span> text.</p>',
				config: {
					// false is default value
					allowedContent: true // Disable filter.
				}
			},
			function( bot ) {
				var editor = bot.editor,
					range = editor.createRange(),
					style = new CKEDITOR.style( { name: 'Bold', element: 'b' } );

				range.selectNodeContents( editor.editable() );
				editor.getSelection().selectRanges( [ range ] );
				editor.applyStyle( style );

				assert.isTrue( editor.document.getById( 'marker2' ).hasAscendant( 'b' ) );
			}
		);
	},

	'test style.parse.margin docs sample': function() {
		objectAssert.areEqual( { top: '3px', right: '0', bottom: '2', left: '0' }, CKEDITOR.tools.style.parse.margin( '3px 0 2' ) );
	},

	'test style.parse.border docs sample': function() {
		objectAssert.areEqual( { width: '3px', style: 'solid', color: '#ffeedd' }, CKEDITOR.tools.style.parse.border( '3px solid #ffeedd' ) );
	},

	'test style.parse.border only with width': function() {
		objectAssert.areEqual( { width: '0%' }, CKEDITOR.tools.style.parse.border( '0%' ) );
	},

	'test style.parse.border only with zero width': function() {
		objectAssert.areEqual( { width: '0' }, CKEDITOR.tools.style.parse.border( '0' ) );
	},

	'test style.parse.border only with zero width with dot': function() {
		objectAssert.areEqual( {}, CKEDITOR.tools.style.parse.border( '0.' ) );
	},

	'test style.parse.border with width and style': function() {
		objectAssert.areEqual( { width: '0%', style: 'groove' }, CKEDITOR.tools.style.parse.border( '0% groove' ) );
	},

	'test style.parse.border with mixed color and style': function() {
		objectAssert.areEqual( { color: '#ff0000', style: 'dotted' }, CKEDITOR.tools.style.parse.border( '#ff0000 dotted' ) );
	},

	'test style.parse.border with mixed color, style and width': function() {
		objectAssert.areEqual( { width: '7.5em', color: '#ff0000', style: 'dotted' }, CKEDITOR.tools.style.parse.border( '#ff0000 dotted 7.5em' ) );
	},

	'test style.parse.border with style only': function() {
		objectAssert.areEqual( { style: 'dotted' }, CKEDITOR.tools.style.parse.border( 'dotted' ) );
	},

	'test style.parse.border with style and rgba color': function() {
		objectAssert.areEqual( { style: 'dotted', color: 'rgba(0,0,0,0)' }, CKEDITOR.tools.style.parse.border( 'dotted rgba(0,0,0,0)' ) );
	},

	'test style.parse.border with style and hsla color': function() {
		objectAssert.areEqual( { style: 'dotted', color: 'hsla(10,30%,30%,1)' }, CKEDITOR.tools.style.parse.border( 'dotted hsla(10,30%,30%,1)' ) );
	}

} );
} )();