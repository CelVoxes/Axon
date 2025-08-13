const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const BundleAnalyzerPlugin =
	require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

module.exports = (env, argv) => {
	const isProduction = argv.mode === "production";

	return {
		target: "electron-renderer",
    // Ensure Node built-ins are not externalized; we want browser polyfills
    externalsPresets: {
      node: false,
      electron: false,
      electronRenderer: false,
      web: true,
    },
		externals: [],
		entry: {
			main: "./src/renderer/index.tsx",
		},
		output: {
			path: path.resolve(__dirname, "dist"),
			filename: isProduction ? "[name].[contenthash].js" : "[name].js",
			clean: isProduction ? true : false,
		},
		module: {
			rules: [
				{
					test: /\.m?js$/,
					resolve: {
						fullySpecified: false,
					},
				},
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
					parser: {
						dataUrlCondition: {
							maxSize: 8 * 1024, // 8kb
						},
					},
				},
			],
		},
		resolve: {
			extensions: [".tsx", ".ts", ".js"],
			mainFields: ["browser", "module", "main"],
			alias: {
				"@components": path.resolve(__dirname, "src/renderer/components"),
				undici: false,
			},
			// Prefer browser conditions when resolving package exports
			conditionNames: ["webpack", "browser", "import", "module", "default"],
			fallback: {
				path: false,
				fs: false,
				os: false,
				net: false,
				child_process: false,
				util: false,
				ws: false,
				crypto: false,
				stream: false,
				buffer: require.resolve("buffer/"),
				process: false,
				url: false,
				querystring: false,
				http: false,
				https: false,
				zlib: false,
				assert: false,
				constants: false,
				domain: false,
				events: false,
				punycode: false,
				string_decoder: false,
				sys: false,
				timers: false,
				tty: false,
				vm: false,
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
			// Add bundle analyzer in production or when --analyze flag is used
			...(env.analyze ? [new BundleAnalyzerPlugin()] : []),
			// Add Node.js polyfills for browser compatibility
			new NodePolyfillPlugin(),
			// Add global polyfill for Node.js compatibility
			new (require("webpack").DefinePlugin)({
				global: "window",
				"process.env.FIREBASE_API_KEY": JSON.stringify(
					process.env.FIREBASE_API_KEY || ""
				),
				"process.env.FIREBASE_AUTH_DOMAIN": JSON.stringify(
					process.env.FIREBASE_AUTH_DOMAIN || ""
				),
				"process.env.FIREBASE_PROJECT_ID": JSON.stringify(
					process.env.FIREBASE_PROJECT_ID || ""
				),
				"process.env.FIREBASE_APP_ID": JSON.stringify(
					process.env.FIREBASE_APP_ID || ""
				),
			}),
			new (require("webpack").ProvidePlugin)({
				Buffer: ["buffer", "Buffer"],
			}),
		],
		devtool: isProduction ? false : "source-map",
		optimization: {
			usedExports: true,
			sideEffects: false,
			splitChunks: {
				chunks: "all",
				cacheGroups: {
					vendor: {
						test: /[\\/]node_modules[\\/]/,
						name: "vendors",
						chunks: "all",
					},
					monaco: {
						test: /[\\/]node_modules[\\/]@monaco-editor[\\/]/,
						name: "monaco",
						chunks: "all",
						priority: 10,
					},
					react: {
						test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
						name: "react",
						chunks: "all",
						priority: 10,
					},
				},
			},
		},
		performance: {
			hints: isProduction ? "warning" : false,
			maxEntrypointSize: 512000,
			maxAssetSize: 512000,
		},
	};
};
