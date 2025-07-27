const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

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
			{
				test: /\.(png|jpg|jpeg|gif|svg)$/,
				type: "asset/resource",
			},
		],
	},
	resolve: {
		extensions: [".tsx", ".ts", ".js"],
		fallback: {
			path: false,
			fs: false,
			os: false,
			net: false,
			child_process: false,
			util: false,
			ws: false,
		},
	},
	plugins: [
		new HtmlWebpackPlugin({
			template: "./src/renderer/index.html",
			filename: "index.html",
		}),
		new CopyWebpackPlugin({
			patterns: [
				{
					from: "src/png",
					to: "png",
				},
			],
		}),
	],
	devtool: "source-map",
};
