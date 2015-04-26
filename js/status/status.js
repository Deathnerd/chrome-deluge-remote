/*
 * Responsible for all display, page or functional control on the status page.
 *
 * - Setting refresh timers.
 * - Rendering HTML for table.
 * - Logic for action buttons.
 */
$(function() {
	// Get extension background page for use within the code.
	var backgroundPage = chrome.extension.getBackgroundPage();
		// Store the extension activation state.
	var extensionActivated = false;
	var checked = [];
		// Set the initial height for the overlay.
	var $overlay = $('#overlay').css({ height: $(document).height() });


	// Setup timer information.
	const REFRESH_INTERVAL = 30000;
	var refreshTimer = Timer(REFRESH_INTERVAL);

	// I can't get the popup to play nicely when there is a scroll bar and then
	// when there isn't - so going to adjust the width if a scroll bar is
	// visible (this needs to be done on timeout to give popup time to show).
	//
	// See: http://code.google.com/p/chromium/issues/detail?id=31494
	//
	// Listen for a table refresh event and add the class if needed.
	/*$(document).bind('table_updated', function (e) {
		if ($(document).height() > $(window).height()) {
			$('body').addClass('scrollbars');
		}
	});*/

	/*
	 * Helper function for creating progress bar element.
	 */
	function progressBar(torrent) {
		var $bar = $(document.createElement('div')).addClass('progress_bar');
		$(document.createElement('div'))
			.addClass('inner')
			.css('width', torrent.getPercent())
			.appendTo($bar);

		$(document.createElement('span'))
			.html(torrent.getPercent() + " - " + torrent.state)
			.appendTo($bar);

		return $bar;
	}

	function actionLinks(torrent) {
		// Work out which states to use based on torrent information.
		var state = torrent.state === 'Paused' ? 'resume' : 'pause'
		var managed = torrent.autoManaged ? 'managed' : 'unmanaged';

		return $(document.createElement('div'))
			.addClass('main_actions')
			.append(
				// Pause/Resume buttons.
				$(document.createElement('a')).addClass('state').addClass(state).prop('title', 'Pause/Resume Torrent'),
				// Move up button.
				$(document.createElement('a')).addClass('move_up').prop('title', 'Move Torrent Up'),
				$(document.createElement('a')).addClass('move_down').prop('title', 'Move Torrent Down'),
				// Auto managed options.
				$(document.createElement('a')).addClass('toggle_managed').addClass(managed).prop('title', 'Toggle Auto-managed State'),
				// Delete.
				$(document.createElement('a')).addClass('delete').prop('title', 'Delete Options')
			);
	}

	function updateTable() {
		// Clear out any existing timers.
		refreshTimer.unsubscribe();
		$("[name=selected_torrents]:checked").each(function () {
			checked.push($(this).val());
		});
		Torrents.update()
			.success(function () {
				renderTable();
				renderGlobalInformation();
				refreshTimer.subscribe(updateTable);
			})
			.error(function () {
				// Problem fetching information, perform a status check.
				// Note: Not setting a timeout, should happen once updateTable
				// gets called when extension check is OK.
				checkStatus();
			});
	}

	/**
	 * Pause the table refresh.
	 */
	function pauseTableRefresh() {
		refreshTimer.unsubscribe();
	}

	 /**
	* Resume the table refresh.
	*/
	function resumeTableRefresh() {
		refreshTimer.unsubscribe();
		refreshTimer.subscribe(updateTable);
	}

	function renderGlobalInformation() {
		var information = Torrents.getGlobalInformation();
		$globalInformation = $('#global-information');

		if (Global.getDebugMode()) {
			console.log(Torrents);
			console.log(information);
		}

		$('.all', $globalInformation).html(information.all);
		$('.downloading', $globalInformation).html(information.downloading);
		$('.paused', $globalInformation).html(information.paused);
		$('.seeding', $globalInformation).html(information.seeding);
		$('.queued', $globalInformation).html(information.queued);
	}

	function renderTable() {
		// Fetch new information.
		var torrents = Torrents.getAll();
		$(".torrent_row").remove();
		for (var i = 0; i < torrents.length ; i++) {
			var torrent = torrents[i];

			var t = $("<div>")
				.data({ id: torrent.id }) /* Store torrent id */
				.addClass('torrent_row')
				.append(
					$("<table>").append($("<tr>").append(
						$("<td>").addClass('table_cell_position').html(torrent.getPosition()),
						$("<td>").addClass('table_cell_name').html(torrent.name)
					)),
					$("<table>").append($("<tr>").append(
						$("<td>").addClass('table_cell_size').html((torrent.progress != 100 ? torrent.getHumanDownloadedSize() + " of " : "" ) + torrent.getHumanSize()), // 
						$("<td>").addClass('table_cell_eta').html("ETA: " + torrent.getEta()),
						$("<td>").addClass('table_cell_ratio').html("Ratio: " + torrent.getRatio()),
						$("<td>").addClass('table_cell_peers').html("Peers: " + torrent.num_peers + "/" + torrent.total_peers),
						$("<td>").addClass('table_cell_seeds').html("Seeds: " + torrent.num_seeds + "/" + torrent.total_seeds),
						//$("<td>").addClass('table_cell_seeds-peers').html("(" + torrent.seeds_peers_ratio.toFixed(1) + ")"), //this doesn't really look good
						$("<td>").addClass('table_cell_speed').html(torrent.getSpeeds())
					)),
					$("<table>").append($("<tr>").append(
						$("<td>").addClass('table_cell_progress').html(progressBar(torrent))
					)),
					$("<table>").append($("<tr>").append(
						$("<td>").addClass('table_cell_actions').append(actionLinks(torrent))
					))
				);
			$("#torrent_container").append(t);
		}

		//$(document).trigger('table_updated');
	}

	(function () {
		function getRowData(element) {
			var parent = $(element).parents(".torrent_row");
			var torrentId = parent.data('id');
			var torrent = Torrents.getById(torrentId);
			return {'torrentId': torrentId, 'torrent': torrent};
		}

		var $mainActions = $('.main_actions');

		$('.toggle_managed', $mainActions).on('click', function () {
			var rowData = getRowData(this);
			var autoManaged = !rowData.torrent.autoManaged;

			Deluge.api('core.set_torrent_auto_managed', [rowData.torrentId, autoManaged])
				.success(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Auto managed - ' + autoManaged);
					}
					updateTable();
				})
				.error(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Failed to toggle auto managed');
					}
				});
		});

		function setTorrentStates(method, torrentIds) {
			Deluge.api(method, [torrentIds])
				.success(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Updated state');
					}
					updateTable();
				})
				.error(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Failed to update state');
					}
				});
		}

		$("#torrent_container").on("click", ".main_actions .state", function() {
			var rowData = getRowData(this);
			var method = rowData.torrent.state === 'Paused' ? 'core.resume_torrent' : 'core.pause_torrent';
			setTorrentStates(method, [rowData.torrentId]);
		});
		$('.state', $mainActions).on('click', function () {
			var rowData = getRowData(this);
			var method = rowData.torrent.state === 'Paused' ? 'core.resume_torrent' : 'core.pause_torrent';
			setTorrentStates(method, [rowData.torrentId]);
		});

		$('.move_up', $mainActions).on('click', function () {
			var rowData = getRowData(this);

			Deluge.api('core.queue_up', [[rowData.torrentId]])
				.success(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Moved torrent up');
					}
					updateTable();
				})
				.error(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Failed to move torrent up');
					}
				});
		});

		$('.move_down', $mainActions).on('click', function () {
			var rowData = getRowData(this);

			Deluge.api('core.queue_down', [[rowData.torrentId]])
				.success(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Moved torrent down');
					}
					updateTable();
				})
				.error(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Failed to move torrent down');
					}
				});
		});
		
		console.log($('.delete', $mainActions));

		$('.delete', $mainActions).on('click', function () {
			pauseTableRefresh();

			var newElm = $('<div>');

			newElm.addClass('delete-options').hide();
			$('.main_actions', $(this).parents('td')).hide();
			$(this).parents('td').append(newElm);
			newElm.fadeIn('fast', function () {
				var $tmp = $(this);

				$tmp.append(
					// Cancel.
					$(document.createElement('a')).addClass('cancel').prop('rel', 'cancel').prop('title', 'Cancel'),
					// Delete torrent and data.
					$(document.createElement('a')).addClass('data').prop('rel', 'data').prop('title', 'Delete with Data'),
					// Delete just torrent.
					$(document.createElement('a')).addClass('torrent').prop('rel', 'torrent').prop('title', 'Delete just Torrent File')
				);
			});
		});

		function removeTorrent(id, delData) {
			Deluge.api('core.remove_torrent', [id, delData])
				.success(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Removed torrent');
					}
				})
				.error(function () {
					if (Global.getDebugMode()) {
						console.log('Deluge: Failed to remove torrent');
					}
				});
		}

		$('.delete-options a').on('click', function () {
			var action = $(this).attr('rel') || 'cancel'
				, parentClass = $(this).parents('td').attr('class')
				, delData = (action === 'data') ? true : false
				, rowData;

			function removeButtons() {
				// Remove buttons, resume refresh.
				$('.delete-options').fadeOut('fast', function () {
					resumeTableRefresh();
					updateTable();
				});
			}

			// If cancelling remove overlay and resume refresh now and return.
			if (action === 'cancel') {
				removeButtons();
				return false;
			}

			if (parentClass === 'table_cell_actions') {
				rowData = getRowData(this);
				removeTorrent(rowData.torrentId, delData);
			} else {
				$("[name=selected_torrents]:checked").each(function () {
					rowData = getRowData(this);
					removeTorrent(rowData.torrentId, delData);
				});
			}
			removeButtons();
			return false;
		});

		function performMassRemove(delData) {
			$(':checked', '.torrent_row').each(function (i, sel) {
				removeTorrent($(sel).val(), delData);
			});
		}

		$('#delete-selected-torrent').on('click', function () {
			performMassRemove(false);
		});

		$('#delete-selected-data').on('click', function () {
			performMassRemove(true);
		});

		function getSelTorrents() {
			var torrents = [];
			$(':checked', '.torrent_row').each(function (i, sel) {
				torrents.push($(sel).val());
			});

			return torrents
		}

		$('#pause-selected').on('click', function () {
			setTorrentStates('core.pause_torrent', getSelTorrents());
		});

		$('#resume-selected').on('click', function () {
			setTorrentStates('core.resume_torrent', getSelTorrents());
		});

		$('#select-all').on('click', function () {
			$('.table_cell_checkbox').find(':checkbox').attr('checked', this.checked);
		});
	}());

	(function () {
		$('#add-torrent').click(function(e) {
			e.preventDefault();
			$('#add-torrent-dialog').show();
			$('#add-torrent-dialog').click(function(e) {
				$(this).hide();
			});

			/* Don't closed if clicked within .inner */
			$('#add-torrent-dialog .inner').click(function(e) {
				e.stopPropagation();
			});
		});
		// For some reason the link has focus when the status is shown, however
		// we can't blur straight away, wait 50ms then do it.
		setTimeout(function() { $('#add-torrent').blur(); }, '50');

		$('#add-torrent-dialog .close').click(function(e) {
			e.preventDefault();
			$('#add-torrent-dialog').hide()
		});

		var $inputBox = $('#manual_add_input')
			, $addButton = $('#manual_add_button');

		$inputBox.keydown(function (event) {
			if (event.keyCode === '13') {
				event.preventDefault();
				$addButton.click();
			}
		});

		$addButton.on('click', function (e) {
			e.preventDefault();
			var url = $inputBox.val();

			// Now check that the link contains either .torrent or download, get, etc...
			if (url.search(/\/(download|get)\//) > 0 || url.search(/\.torrent$/) > 0) {
				chrome.extension.sendRequest({ msg: 'add_torrent_from_url', url: url},
					function (response) {
						if (response.msg === 'success') {
							$inputBox.val('');
						}
					});
			} else if (url.search(/magnet:/) != -1) {
				chrome.extension.sendRequest({ msg: 'add_torrent_from_magnet', url: url},
					function (response) {
						console.log(response);
						if (response.msg === 'success') {
							$inputBox.val('');
						}
					});
			}

			$('#add-torrent-dialog').hide();
		});
	}());

	$(function() {
		$('#table_header_' + localStorage.sortColumn).addClass('sorted ' + localStorage.sortMethod);

		$('.sortable').click(function () {
			var $link = $(this)
				, column = $link.attr('rel');
			// If the link clicked is different to the active one
			// then reset the assending order and add the active class.
			if (column === localStorage.sortColumn) {
				// If it's the same just change the sorting order.
				localStorage.sortMethod = localStorage.sortMethod === 'asc' ? 'desc' : 'asc';
				$link.removeClass('asc desc').addClass(localStorage.sortMethod);
			} else {
				// Make sure none of the links are the active one.
				$('.sortable').removeClass('sorted asc desc');
				$link.addClass('sorted asc');

				localStorage.sortMethod = 'asc';
				localStorage.sortColumn = column;
			}
			updateTable();
		});
	}());

	/*
	 * Check the status of the extension and do the handling for the popup.
	 *
	 * This function only displays error messages, it's the job of the
	 * background page to inform us the error has been resolved so we can update
	 * the table.
	 */
	function checkStatus() {
		backgroundPage.Background.checkStatus({ timeout: 1000 }).success(function (response) {
			if (response === false) {
				// Most likely still waiting on daemon to start.
				$('span', $overlay).removeClass().addClass('error').html(
					chrome.i18n.getMessage('error_daemon_not_running')
				);
				$overlay.show();
			}
		}).error(function (jqXHR, text, err) {
			var message = chrome.i18n.getMessage('error_generic');
			/*
			 * Ignore any unauthenticated errors here - they are normally
			 * resolved by an auto login in the background stuff and is normally
			 * sorted before this message can be fully displayed.
			 *
			 * We will instead receive errors from the global event for auto
			 * login failure to display the message to the user - see
			 * autoLoginFailed and Chrome extension addListner.
			 */
			if (err.code !== Deluge.API_AUTH_CODE) {
				$('span', $overlay).removeClass().addClass('error').html(message);
				$overlay.show();
			}
		});
	}

	// This function is called when the background page sends an activated
	// message, this happens roughly every minute so we only want to call
	// updateTable, or hide any current overlays once. We can let the local
	// timers within this script handle table updating.
	function activated() {
		if (!extensionActivated) {
			if (Global.getDebugMode()) {
				console.log('Deluge: ACTIVATED');
			}
			extensionActivated = true;
			$overlay.hide();
			updateTable();
		}
	}

	function deactivated() {
		extensionActivated = false;
	}

	function autoLoginFailed() {
		var message = chrome.i18n.getMessage('error_unauthenticated');
		$('span', $overlay).addClass('error').html(message);
		$overlay.show();
	}

	// Setup listeners for closing message overlays coming from background.
	chrome.extension.onRequest.addListener(
		function (request, sender, sendResponse) {
			if (Global.getDebugMode()) {
				console.log(request.msg);
			}
			if (request.msg === 'extension_activated') {
				activated();
			} else if (request.msg === 'extension_deactivated') {
				deactivated();
			} else if (request.msg === 'auto_login_failed') {
				autoLoginFailed();
			}
		}
	);

	$("#deluge_webui_link").attr("href", localStorage.delugeAddress);
	// Do initial check.
	checkStatus();
});
