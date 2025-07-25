const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
	target: "electron-renderer",
	entry: "./src/renderer/index.tsx",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: "renderer.js",
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: "ts-loader",
				exclude: /node_modules/,
			},
			{
				test: /\.css$/,
				use: ["style-loader", "css-loader"],
			},
		],
	},
	resolve: {
		extensions: [".tsx", ".ts", ".js"],
	},
	plugins: [
		new HtmlWebpackPlugin({
			template: "./src/renderer/index.html",
			filename: "index.html",
		}),
	],
	devtool: "source-map",
};
