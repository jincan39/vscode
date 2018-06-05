/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { workspace, window, commands, ViewColumn, TextEditorViewColumnChangeEvent, Uri, Selection, Position, CancellationTokenSource, TextEditorSelectionChangeKind } from 'vscode';
import { join } from 'path';
import { closeAllEditors, pathEquals, createRandomFile } from '../utils';

suite('window namespace tests', function () {

	suite('QuickInput tests', function () {
		this.timeout(5000000);

		teardown(closeAllEditors);

		test('createQuickPick, select first', function (done) {
			const quickPick = window.createQuickPick();
			quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
			quickPick.onDidSelectionChange(items => {
				try {
					quickPick.dispose();
					assert.equal(items.length, 1);
					assert.equal(items[0].label, 'eins');
					done();
				} catch (err) {
					done(err);
				}
			});
			quickPick.show();

			setTimeout(() => {
				commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
			}, 0);
		});
	});
});
