var viewModel;
function navigatedTo(args) {
    var page = args.object;
    viewModel = page.navigationContext;
    page.bindingContext = null;
    page.bindingContext = viewModel;
    viewModel.loadPhoto();
}
exports.navigatedTo = navigatedTo;
//# sourceMappingURL=view-task.js.map